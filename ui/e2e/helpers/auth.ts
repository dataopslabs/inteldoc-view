import { Page } from '@playwright/test';
import { execSync } from 'child_process';

const CLIENT_ID = 'm0ud627mo92vldpq32k6ev44o';
const TEST_EMAIL = 'e2etest@docops.test';
const TEST_PASSWORD = 'Test@12345!';

interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Gets fresh Cognito tokens for the test user via AWS CLI.
 */
export function getTestTokens(): CognitoTokens {
  const result = execSync(
    `aws cognito-idp initiate-auth \
      --auth-flow USER_PASSWORD_AUTH \
      --client-id "${CLIENT_ID}" \
      --auth-parameters USERNAME="${TEST_EMAIL}",PASSWORD="${TEST_PASSWORD}" \
      --query 'AuthenticationResult' \
      --output json`,
    { encoding: 'utf8', timeout: 15000 }
  ).trim();

  const auth = JSON.parse(result);
  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
  };
}

/**
 * Injects Amplify v6 auth tokens into localStorage BEFORE the page scripts run,
 * so that Amplify's auth initialisation finds a valid session immediately.
 *
 * Must be called before page.goto() — uses addInitScript which is registered
 * once and fires on every subsequent navigation for the lifetime of the page.
 */
export async function loginViaLocalStorage(page: Page): Promise<void> {
  const tokens = getTestTokens();

  // addInitScript runs before ANY page JavaScript, including Amplify's init.
  // This ensures getCurrentUser() finds valid tokens on the very first read.
  await page.addInitScript(
    ({ tokens, clientId, email }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      localStorage.setItem(`${prefix}.LastAuthUser`, email);
      localStorage.setItem(`${prefix}.${email}.idToken`, tokens.idToken);
      localStorage.setItem(`${prefix}.${email}.accessToken`, tokens.accessToken);
      localStorage.setItem(`${prefix}.${email}.refreshToken`, tokens.refreshToken);
      localStorage.setItem(`${prefix}.${email}.clockDrift`, '0');
      localStorage.setItem(
        `${prefix}.${email}.signInDetails`,
        JSON.stringify({ loginId: email, authFlowType: 'USER_PASSWORD_AUTH' })
      );
    },
    { tokens, clientId: CLIENT_ID, email: TEST_EMAIL }
  );
}
