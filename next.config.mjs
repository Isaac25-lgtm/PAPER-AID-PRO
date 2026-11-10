/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "35mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/pricing",
        destination: "/",
        permanent: true,
      },
      {
        source: "/tools",
        destination: "/discover",
        permanent: true,
      },
      {
        source: "/tools/chat-pdf",
        destination: "/research",
        permanent: true,
      },
      {
        source: "/articles",
        destination: "/papers",
        permanent: true,
      },
      {
        source: "/saved",
        destination: "/library",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
