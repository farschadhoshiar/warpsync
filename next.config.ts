import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'ssh2', 
    'node-ssh', 
    'cpu-features',
    'pino',
    'pino-pretty',
    'pino-abstract-transport',
    'thread-stream',
    'sonic-boom'
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle server-only packages on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        util: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
        worker_threads: false,
        child_process: false,
      };
      
      // Exclude SSH, pino, and native modules from client bundle
      config.externals = config.externals || [];
      config.externals.push({
        'ssh2': 'commonjs ssh2',
        'node-ssh': 'commonjs node-ssh',
        'cpu-features': 'commonjs cpu-features',
        'pino': 'commonjs pino',
        'pino-pretty': 'commonjs pino-pretty',
        'thread-stream': 'commonjs thread-stream',
        'sonic-boom': 'commonjs sonic-boom'
      });
    }
    
    // Ignore optional native dependencies and problematic modules
    config.resolve.alias = {
      ...config.resolve.alias,
      'cpu-features': false,
      'ssh2/lib/protocol/crypto/build/Release/sshcrypto.node': false,
    };
    
    // Handle native modules and worker files
    config.module.rules.push({
      test: /\.node$/,
      use: 'raw-loader',
    });
    
    // Ignore missing optional dependencies and worker thread issues
    config.ignoreWarnings = [
      /Module not found: Error: Can't resolve 'cpu-features'/,
      /Module not found: Error: Can't resolve 'ssh2\/lib\/protocol\/crypto\/build\/Release\/sshcrypto.node'/,
      /Critical dependency: the request of a dependency is an expression/,
      /Module not found: Error: Can't resolve 'worker_threads'/,
      /Module not found: Error: Can't resolve.*worker\.js/,
    ];
    
    return config;
  },
  // Disable webpack dev overlay for better error handling in development
  ...(process.env.NODE_ENV === 'development' && {
    onDemandEntries: {
      // period (in ms) where the server will keep pages in the buffer
      maxInactiveAge: 25 * 1000,
      // number of pages that should be kept simultaneously without being disposed
      pagesBufferLength: 2,
    },
  }),
};

export default nextConfig;
