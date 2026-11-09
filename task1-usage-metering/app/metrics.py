from prometheus_client import Counter, Histogram

WEBHOOK_EVENTS = Counter(
    "callzo_webhook_events_total",
    "Webhook deliveries by outcome",
    ["outcome"],
)

WEBHOOK_LATENCY = Histogram(
    "callzo_webhook_seconds",
    "Time spent handling a webhook delivery, including inline processing",
)
