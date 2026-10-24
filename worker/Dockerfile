FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home worker
COPY --chown=worker:worker countries.py fx.py names.py prices.py quotes.py refresh.py symbols.py worker/
COPY --chown=worker:worker country-funds.json fund-country-weights.json worker/
USER worker
ENTRYPOINT ["python", "-m", "worker.fx"]
