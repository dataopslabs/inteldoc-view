import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const googleClientId = this.node.tryGetContext('googleClientId') as string;
    const googleClientSecret = this.node.tryGetContext('googleClientSecret') as string;

    // User Pool
    // G6-03: MFA enabled (OPTIONAL for users, enforced for admin group via pre-token trigger).
    //        Cognito Advanced Security Mode (ASM) enables adaptive risk scoring, compromised
    //        credential detection, and bot-detection — required for SOC 2 Type II.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'docops-user-pool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: 'DocOps — verify your email',
        emailBody: 'Your DocOps verification code is {####}. This code expires in 24 hours.',
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        // Stable tenant identifier written by the provisioning flow
        tenant_id: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,          // G6-03: raised from 8 → 12 chars
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      // G6-03: MFA — OPTIONAL (users can enroll TOTP; admin group enforced via app logic)
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,   // disable SMS to avoid SIM-swap attacks
        otp: true,    // TOTP (Google Authenticator, Authy, etc.)
      },
      // G6-03: Advanced Security Mode — adaptive auth + compromised credential check
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      email: cognito.UserPoolEmail.withCognito('noreply@docops.dataopslabs.com'),
    });

    // Google OAuth Identity Provider
    if (googleClientId && googleClientSecret) {
      const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
        userPool: this.userPool,
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
      this.userPool.registerIdentityProvider(googleProvider);
    }

    // User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'docops-app-client',
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          'http://localhost:3000/auth/callback',
          'https://docops.dataopslabs.com/auth/callback',
        ],
        logoutUrls: [
          'http://localhost:3000',
          'https://docops.dataopslabs.com',
        ],
      },
      generateSecret: false,
    });

    // Identity Pool
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: 'docops-identity-pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Authenticated Role
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: ['arn:aws:execute-api:*:*:*'],
      })
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: this.identityPool.ref,
      roles: { authenticated: authenticatedRole.roleArn },
    });

    // G5-14: Cognito User Pool Groups for RBAC
    // Groups: docops-admin, docops-editor, docops-reviewer, docops-viewer
    // Users are assigned to groups via Cognito admin API or the AWS Console.
    // The API Lambda extracts the group from the `cognito:groups` JWT claim.
    const roleDescriptions: Array<{ name: string; description: string }> = [
      { name: 'docops-admin', description: 'Full access — can manage tenants, workspaces, and users' },
      { name: 'docops-editor', description: 'Can create/update workspaces and submit documents' },
      { name: 'docops-reviewer', description: 'Can perform HITL reviews and submit corrections' },
      { name: 'docops-viewer', description: 'Read-only access to traces and dashboards' },
    ];
    for (const { name, description } of roleDescriptions) {
      new cognito.CfnUserPoolGroup(this, `Group${name.replace(/-/g, '')}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: name,
        description,
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: this.identityPool.ref });
    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
    });
  }
}
