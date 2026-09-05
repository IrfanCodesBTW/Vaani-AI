# Rumik TTS + VoiceLink telephony overlay on the official Dograh API image.
#
# --no-deps is REQUIRED: Dograh vendors its own pipecat fork (tagged v1.1.0)
# but setuptools_scm cannot read the submodule tags, so the installed
# pipecat-ai reports 0.0.0.dev0. pipecat-rumik declares pipecat-ai>=1.0.0,<2,
# so a normal install would either fail resolution or pull upstream pipecat
# from PyPI straight over Dograh's fork and break the box.
# Its other three deps (aiohttp, certifi, websockets) are already in the image.
#
# Build from the repo root:
#   docker build -f rumik-overlay-local/Dockerfile -t dograh-api-rumik:local .
FROM ghcr.io/dograh-hq/dograh-api:latest

# The base image runs as `dograh`, but /opt/venv is root-owned.
USER root
RUN pip install --no-cache-dir --no-deps pipecat-rumik==0.1.4

# Rumik TTS provider
COPY --chown=dograh:dograh rumik-overlay-local/registry.py        /app/api/services/configuration/registry.py
COPY --chown=dograh:dograh rumik-overlay-local/check_validity.py  /app/api/services/configuration/check_validity.py
COPY --chown=dograh:dograh rumik-overlay-local/service_factory.py /app/api/services/pipecat/service_factory.py

# VoiceLink telephony provider (Harddiikk/dograh-voicelink-plugin)
COPY --chown=dograh:dograh dograh-local/api/services/telephony/providers/voicelink /app/api/services/telephony/providers/voicelink
COPY --chown=dograh:dograh dograh-local/api/services/telephony/providers/__init__.py /app/api/services/telephony/providers/__init__.py
COPY --chown=dograh:dograh dograh-local/api/enums.py /app/api/enums.py
COPY --chown=dograh:dograh dograh-local/api/schemas/telephony_config.py /app/api/schemas/telephony_config.py
COPY --chown=dograh:dograh dograh-local/api/routes/telephony.py /app/api/routes/telephony.py
COPY --chown=dograh:dograh dograh-local/api/db/telephony_phone_number_client.py /app/api/db/telephony_phone_number_client.py

# Restore the base image's runtime user.
USER dograh
