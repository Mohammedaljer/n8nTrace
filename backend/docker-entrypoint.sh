#!/bin/sh
set -e

echo "Running migrations..."
npm run migrate:up

echo "Starting backend..."
npm run start
