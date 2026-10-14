declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    AI?: import('./lib/strategy-ai-server').AIBinding;
    CLOUDFLARE_AI_ACCOUNT_ID?: string;
    CLOUDFLARE_AI_API_TOKEN?: string;
    STEWARD_AI_ENABLED?: string;
    BUCKET?: R2Bucket;
    OC_API_KEY?: string;
    OC_SECRET_KEY?: string;
    ALCHEMY_API_KEY?: string;
    STEWARD_WORKER_KEY?: string;
    STEWARD_VAPID_PUBLIC_KEY?: string;
    STEWARD_VAPID_PRIVATE_KEY?: string;
    STEWARD_RUNNER_ENABLED?: string;
    STEWARD_AUTONOMOUS_SHADOW_ENABLED?: string;
    STEWARD_DEMO_AUTH?: string;
    STEWARD_SIGNER_ENCRYPTION_KEY?: string;
    STEWARD_AUTONOMY_REVIEW_AUTHORITIES?: string;
    STEWARD_NEWS_ENABLED?: string;
    STEWARD_NEWS_REALTIME_VERIFIED?: string;
    STEWARD_NEWS_USE_VERIFIED?: string;
    STEWARD_NEWS_KEY_ID?: string;
    STEWARD_NEWS_SECRET_KEY?: string;
    STEWARD_OPERATOR_ALERTS_ENABLED?: string;
    STEWARD_OPERATOR_ALERT_URL?: string;
    STEWARD_OPERATOR_ALERT_SECRET?: string;
  }
}
