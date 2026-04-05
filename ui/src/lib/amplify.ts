import { Amplify } from 'aws-amplify';

export function configureAmplify() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cognitoConfig: any = {
    userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
    userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
    loginWith: {
      oauth: {
        domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN!,
        scopes: ['openid', 'email', 'profile'],
        redirectSignIn: [
          'http://localhost:3000/auth/callback',
          ...(appUrl ? [`${appUrl}/auth/callback`] : []),
        ],
        redirectSignOut: [
          'http://localhost:3000',
          ...(appUrl ? [appUrl] : []),
        ],
        responseType: 'code',
      },
    },
  };

  if (process.env.NEXT_PUBLIC_IDENTITY_POOL_ID) {
    cognitoConfig.identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID;
  }

  Amplify.configure({ Auth: { Cognito: cognitoConfig } });
}
