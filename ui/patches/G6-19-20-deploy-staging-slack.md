# G6-19 + G6-20: Staging Gate + Readiness Smoke Test + Slack Notifications

## File: `.github/workflows/deploy.yml`

Replace the entire deploy.yml with the following production-grade pipeline:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'staging'
        type: choice
        options: [staging, production]
      skip_tests:
        description: 'Skip smoke tests (emergency only)'
        required: false
        default: false
        type: boolean

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # never cancel in-flight deploys

jobs:
  # ── Build ─────────────────────────────────────────────────────────────────
  build:
    name: Build & Synth CDK
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ steps.meta.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: infra/package-lock.json

      - name: Install infra deps
        run: npm ci
        working-directory: infra

      - name: CDK synth
        run: npx cdk synth --all --output cdk.out
        working-directory: infra
        env:
          AWS_DEFAULT_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Upload CDK output
        uses: actions/upload-artifact@v4
        with:
          name: cdk-out
          path: infra/cdk.out/
          retention-days: 7

      - id: meta
        run: echo "version=${{ github.sha }}" >> $GITHUB_OUTPUT

  # ── Deploy to Staging ─────────────────────────────────────────────────────
  deploy-staging:
    name: Deploy → Staging
    runs-on: ubuntu-latest
    needs: [build]
    environment:
      name: staging
      url: ${{ vars.STAGING_URL }}
    steps:
      - uses: actions/checkout@v4

      - name: Download CDK output
        uses: actions/download-artifact@v4
        with:
          name: cdk-out
          path: infra/cdk.out/

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: infra/package-lock.json

      - name: Install infra deps
        run: npm ci
        working-directory: infra

      - name: CDK deploy → staging
        id: cdk_deploy
        run: |
          npx cdk deploy --all \
            --require-approval never \
            --outputs-file staging-outputs.json \
            --context env=staging \
            2>&1 | tee deploy.log
          echo "exit_code=${PIPESTATUS[0]}" >> $GITHUB_OUTPUT
        working-directory: infra
        env:
          AWS_DEFAULT_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}
          AWS_ACCESS_KEY_ID: ${{ secrets.STAGING_AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.STAGING_AWS_SECRET_ACCESS_KEY }}

      - name: Notify Slack — staging deploy started
        if: always()
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":rocket: *Staging Deploy*",
              "attachments": [{
                "color": "${{ steps.cdk_deploy.outputs.exit_code == '0' && 'good' || 'danger' }}",
                "fields": [
                  { "title": "Status", "value": "${{ steps.cdk_deploy.outputs.exit_code == '0' && 'SUCCESS' || 'FAILED' }}", "short": true },
                  { "title": "Commit", "value": "<${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}|${{ github.sha }}>" , "short": true },
                  { "title": "Author", "value": "${{ github.actor }}", "short": true },
                  { "title": "Branch", "value": "${{ github.ref_name }}", "short": true }
                ]
              }]
            }

      - name: Upload deploy outputs
        uses: actions/upload-artifact@v4
        with:
          name: staging-outputs
          path: infra/staging-outputs.json

  # ── Staging Smoke Tests (Readiness Gate) ─────────────────────────────────
  smoke-staging:
    name: Smoke Test → Staging
    runs-on: ubuntu-latest
    needs: [deploy-staging]
    if: ${{ !inputs.skip_tests }}
    steps:
      - uses: actions/checkout@v4

      - name: Download staging outputs
        uses: actions/download-artifact@v4
        with:
          name: staging-outputs
          path: infra/

      - name: Extract API URL from CDK outputs
        id: outputs
        run: |
          API_URL=$(jq -r '.DocOpsApiStack.ApiEndpoint // empty' infra/staging-outputs.json)
          echo "api_url=${API_URL:-$STAGING_API_URL}" >> $GITHUB_OUTPUT
        env:
          STAGING_API_URL: ${{ vars.STAGING_API_URL }}

      - name: Wait for API to stabilize (30s)
        run: sleep 30

      - name: Smoke test — liveness probe
        id: liveness
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${{ steps.outputs.outputs.api_url }}/v1/health")
          echo "status=$STATUS" >> $GITHUB_OUTPUT
          if [ "$STATUS" != "200" ]; then
            echo "❌ Liveness probe failed: HTTP $STATUS"
            exit 1
          fi
          echo "✅ Liveness probe: OK"

      - name: Smoke test — readiness probe
        id: readiness
        run: |
          RESPONSE=$(curl -s "${{ steps.outputs.outputs.api_url }}/v1/health/ready")
          STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"')
          echo "status=$STATUS" >> $GITHUB_OUTPUT
          if [ "$STATUS" != "ready" ] && [ "$STATUS" != "degraded" ]; then
            echo "❌ Readiness probe failed: $STATUS"
            echo "Response: $RESPONSE"
            exit 1
          fi
          echo "✅ Readiness probe: $STATUS"

      - name: Smoke test — auth endpoint reachable
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST "${{ steps.outputs.outputs.api_url }}/v1/auth/register" \
            -H "Content-Type: application/json" \
            -d '{"email":"smoke@test.invalid","password":"NotAPassword123!"}')
          # We expect 400 (validation error) or 409 (already exists) — not 500
          if [ "$STATUS" = "500" ] || [ "$STATUS" = "502" ] || [ "$STATUS" = "503" ]; then
            echo "❌ Auth endpoint unhealthy: HTTP $STATUS"
            exit 1
          fi
          echo "✅ Auth endpoint reachable: HTTP $STATUS (expected 400/409)"

      - name: Notify Slack — staging smoke tests
        if: always()
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "${{ job.status == 'success' && ':white_check_mark:' || ':x:' }} *Staging Smoke Tests*",
              "attachments": [{
                "color": "${{ job.status == 'success' && 'good' || 'danger' }}",
                "fields": [
                  { "title": "Result", "value": "${{ job.status }}", "short": true },
                  { "title": "Liveness", "value": "${{ steps.liveness.outputs.status }}", "short": true },
                  { "title": "Readiness", "value": "${{ steps.readiness.outputs.status }}", "short": true },
                  { "title": "Commit", "value": "<${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}|${{ github.sha }}>", "short": true }
                ]
              }]
            }

  # ── Deploy to Production ──────────────────────────────────────────────────
  deploy-production:
    name: Deploy → Production
    runs-on: ubuntu-latest
    needs: [smoke-staging]
    if: |
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'workflow_dispatch' && inputs.environment == 'production')
    environment:
      name: production
      url: ${{ vars.PRODUCTION_URL }}
    steps:
      - uses: actions/checkout@v4

      - name: Download CDK output
        uses: actions/download-artifact@v4
        with:
          name: cdk-out
          path: infra/cdk.out/

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: infra/package-lock.json

      - name: Install infra deps
        run: npm ci
        working-directory: infra

      - name: Notify Slack — production deploy starting
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":building_construction: *Production Deploy Starting*",
              "attachments": [{
                "color": "warning",
                "fields": [
                  { "title": "Commit", "value": "<${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}|${{ github.sha }}>", "short": true },
                  { "title": "Triggered by", "value": "${{ github.actor }}", "short": true }
                ]
              }]
            }

      - name: CDK deploy → production
        id: cdk_deploy_prod
        run: |
          npx cdk deploy --all \
            --require-approval never \
            --outputs-file prod-outputs.json \
            --context env=production \
            2>&1 | tee deploy.log
        working-directory: infra
        env:
          AWS_DEFAULT_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Wait for production to stabilize (60s)
        run: sleep 60

      - name: Production readiness probe
        id: prod_readiness
        run: |
          RESPONSE=$(curl -s "${{ vars.PRODUCTION_API_URL }}/v1/health/ready")
          STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"')
          echo "status=$STATUS" >> $GITHUB_OUTPUT
          if [ "$STATUS" != "ready" ] && [ "$STATUS" != "degraded" ]; then
            echo "❌ Production readiness failed after deploy: $STATUS"
            exit 1
          fi
          echo "✅ Production is $STATUS"

      - name: Notify Slack — production deploy result
        if: always()
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "${{ job.status == 'success' && ':tada:' || ':fire:' }} *Production Deploy ${{ job.status == 'success' && 'Complete' || 'FAILED' }}*",
              "attachments": [{
                "color": "${{ job.status == 'success' && 'good' || 'danger' }}",
                "fields": [
                  { "title": "Status", "value": "${{ job.status }}", "short": true },
                  { "title": "Readiness", "value": "${{ steps.prod_readiness.outputs.status }}", "short": true },
                  { "title": "Commit", "value": "<${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}|${{ github.sha }}>", "short": true },
                  { "title": "Deployed by", "value": "${{ github.actor }}", "short": true },
                  { "title": "Environment", "value": "<${{ vars.PRODUCTION_URL }}|Production>", "short": true }
                ]
              }]
            }

      - name: Upload production outputs
        if: success()
        uses: actions/upload-artifact@v4
        with:
          name: prod-outputs
          path: infra/prod-outputs.json

  # ── Rollback Gate (auto-rollback on production failure) ───────────────────
  rollback-production:
    name: Rollback Production (if failed)
    runs-on: ubuntu-latest
    needs: [deploy-production]
    if: failure() && needs.deploy-production.result == 'failure'
    environment:
      name: production
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.before }}  # previous commit

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: infra/package-lock.json

      - name: Install infra deps
        run: npm ci
        working-directory: infra

      - name: Notify Slack — initiating rollback
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":rewind: *AUTO-ROLLBACK INITIATED* — production deploy failed",
              "attachments": [{
                "color": "danger",
                "fields": [
                  { "title": "Rolling back to", "value": "${{ github.event.before }}", "short": true },
                  { "title": "Failed commit", "value": "${{ github.sha }}", "short": true }
                ]
              }]
            }

      - name: CDK rollback to previous commit
        run: |
          npx cdk deploy --all \
            --require-approval never \
            --context env=production \
            2>&1 | tee rollback.log
        working-directory: infra
        env:
          AWS_DEFAULT_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Notify Slack — rollback result
        if: always()
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_DEPLOY_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "${{ job.status == 'success' && ':white_check_mark: Rollback succeeded' || ':sos: ROLLBACK FAILED — MANUAL INTERVENTION REQUIRED' }}",
              "attachments": [{
                "color": "${{ job.status == 'success' && 'good' || 'danger' }}"
              }]
            }
```

## Required GitHub Secrets and Variables:

### Secrets:
```
SLACK_DEPLOY_WEBHOOK_URL      — Slack incoming webhook URL
AWS_ACCESS_KEY_ID             — Production AWS key
AWS_SECRET_ACCESS_KEY         — Production AWS secret
STAGING_AWS_ACCESS_KEY_ID     — Staging AWS key
STAGING_AWS_SECRET_ACCESS_KEY — Staging AWS secret
```

### Variables (not secrets):
```
AWS_REGION          — e.g. us-east-1
STAGING_URL         — e.g. https://staging.docops.dataopslabs.com
STAGING_API_URL     — e.g. https://api-staging.docops.dataopslabs.com
PRODUCTION_URL      — e.g. https://docops.dataopslabs.com
PRODUCTION_API_URL  — e.g. https://api.docops.dataopslabs.com
```

## Create Slack App:
1. Go to https://api.slack.com/apps → Create New App
2. Add "Incoming Webhooks" feature
3. Activate and create webhook for #deployments channel
4. Copy webhook URL to `SLACK_DEPLOY_WEBHOOK_URL` secret
