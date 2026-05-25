# DGSMART ERP Admin Panel

This repository contains the scaffold for a Next.js 16.2.4 ERP admin panel with Prisma ORM, role-based dashboards, multi-provider authentication, multilingual interface, and transactional mail support.

## Features

- Next.js 16.2.4 with App Router
- Prisma ORM for PostgreSQL
- Auth.js with email, Google, and Microsoft providers
- Role levels: `SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`, `COLLABORATOR`, `SUPPLIER`, `CUSTOMER`
- XLSX import support with `exceljs`
- GSAP animations for subtle motion
- Multilingual structure ready with `next-intl`
- Mailgun transactional mailing
- Swagger docs plan
- Mobile app placeholder for future API integration
- Dependency update notifier script

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```

3. Run local development server:
   ```bash
   npm run dev
   ```

## Environment

Copy `.env` values from your existing `.env` file and add any missing keys.

## Mobile app folder

A placeholder `mobile-app` folder is included for the future mobile application.
# postgres-boilerplate
