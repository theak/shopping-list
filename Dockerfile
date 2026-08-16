FROM python:3.11-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 42780

CMD ["waitress-serve", "--listen=0.0.0.0:42780", "app:app"]