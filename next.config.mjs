/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ClinicalTrials.gov is called server-side from route handlers; no rewrites needed.
};

export default nextConfig;
