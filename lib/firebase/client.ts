import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";
import { Firestore, getFirestore } from "firebase/firestore";
import { FirebaseStorage, getStorage } from "firebase/storage";

let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

function getFirebaseConfig(): FirebaseOptions {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  };
}

export function getClientFirestore() {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  firestoreInstance = getFirestore(app);
  return firestoreInstance;
}

export function getClientStorage() {
  if (storageInstance) {
    return storageInstance;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  storageInstance = getStorage(app);
  return storageInstance;
}
