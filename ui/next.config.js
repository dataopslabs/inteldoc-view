/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    'aws-amplify',
    '@aws-amplify/auth',
    '@aws-amplify/core',
    '@aws-amplify/api',
    '@aws-amplify/api-graphql',
    '@aws-amplify/api-rest',
    '@aws-amplify/storage',
    '@aws-amplify/ui-react',
    '@aws-amplify/utils',
    '@aws-amplify/rtn-web-browser',
  ],
};

module.exports = nextConfig;
