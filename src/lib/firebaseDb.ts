import { getFirestore } from 'firebase/firestore/lite';
import { app } from './firebase';

// Keep Firestore out of the authentication/login bundle.
export const db = getFirestore(app);
