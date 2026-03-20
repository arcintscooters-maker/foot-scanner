from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    allowed_origins: str = "*"
    max_upload_size_mb: int = 10
    port: int = 8000
    debug: bool = False

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
