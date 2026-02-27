// src/lib/atmosDb.ts
// Cross-project Firestore singleton for Atmos Master DB (project: atmos-master-db)
//
// Atmosify (project: nextn) reads/writes the 103k-track Atmos Master DB using
// a secondary Firebase Admin SDK app initialized with a service account.
//
// Secret setup (Firebase Functions secrets for nextn project):
//   firebase functions:secrets:set ATMOS_DB_SERVICE_ACCOUNT
//   (paste the JSON content of the service account key)

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

export const ATMOS_DB_SERVICE_ACCOUNT = defineSecret("ATMOS_DB_SERVICE_ACCOUNT");

const APP_NAME = "atmos-master-db";

let atmosDbInstance: Firestore | null = null;

export function getAtmosDb(): Firestore {
  if (atmosDbInstance) return atmosDbInstance;

  const existingApp: App | undefined = getApps().find(a => a.name === APP_NAME);

  const app = existingApp ?? (() => {
    const serviceAccount = JSON.parse(ATMOS_DB_SERVICE_ACCOUNT.value());
    return initializeApp({ credential: cert(serviceAccount) }, APP_NAME);
  })();

  atmosDbInstance = getFirestore(app);
  return atmosDbInstance;
}
