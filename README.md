# Neeraj Patient Management System

A small patient-record website built with Node.js, HTML, CSS, and MySQL. It connects to the existing `patient_management_system` database and reads the columns in `details_table` automatically.

## Setup

1. Make sure the MySQL server used by MySQL Workbench is running and `patient_management_system.details_table` exists.
2. Install the Node.js dependencies with `npm install`.
3. Copy `.env.example` to `.env` and enter your MySQL host, username, password, and database name. Do not share or commit `.env`.
4. Start the site with `npm start` and open `http://localhost:3000`.

The app does not create or modify the table schema. It can add, edit, and delete rows in `details_table`; editing and deleting require a primary key. Keep this local until authentication, access controls, and privacy safeguards are added before any real patient data is used.
