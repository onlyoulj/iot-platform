idf_component_register(
    SRCS "app_mqtt.c"
    INCLUDE_DIRS "include"
    REQUIRES json
    PRIV_REQUIRES mqtt esp_timer
)
