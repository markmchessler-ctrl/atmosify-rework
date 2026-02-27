// app/lib/firebase.ts
// Firebase client SDK initialization for the Atmosify Next.js app.
// Initialized once; subsequent imports return the same app instance.

import { initializeApp, getApps, getApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyC-lcxlZ817qt9ro8rtrRtV33Dz03MhjKc",
  authDomain: "studio-8193119013-d66e8.firebaseapp.com",
  projectId: "studio-8193119013-d66e8",
  storageBucket: "studio-8193119013-d66e8.firebasestorage.app",
  messagingSenderId: "965727759668",
  appId: "1:965727759668:web:a3452606e50358f7890961",
};

export const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();
