declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    CLOUDFLARE_AI_ACCOUNT_ID?: string;
    CLOUDFLARE_AI_API_TOKEN?: string;
    STEWARD_AI_ENABLED?: string;
    BUCKET?: R2Bucket;
    OC_API_KEY?: string;
    OC_SECRET_KEY?: string;
    ALPACA_CLIENT_ID?: string;
    ALPACA_CLIENT_SECRET?: string;
    ALPACA_REDIRECT_URI?: string;
    ALPACA_TOKEN_ENCRYPTION_KEY?: string;
    ALPACA_ENV?: string;
    ALPACA_ORDER_SUBMISSION_MODE?: string;
    ALCHEMY_API_KEY?: string;
    STEWARD_WORKER_KEY?: string;
    STEWARD_RUNNER_ENABLED?: string;
    STEWARD_DEMO_AUTH?: string;
    STEWARD_SIGNER_ENCRYPTION_KEY?: string;
  }
}
