import { initializeApp } from 'firebase/app'
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  increment,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMk9tkghG53XkSQYTcr57dJBs9fC2ren0',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'xiyuan-dialect-archive.firebaseapp.com',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    'https://xiyuan-dialect-archive-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'xiyuan-dialect-archive',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    'xiyuan-dialect-archive.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '726513306783',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    '1:726513306783:web:51f92cb0053e34e39626aa',
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)
const entriesRef = collection(db, 'entries')

export function subscribeToEntries(onData, onError) {
  const entriesQuery = query(entriesRef, orderBy('createdAt', 'desc'))

  return onSnapshot(
    entriesQuery,
    (snapshot) => {
      onData(snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })))
    },
    onError,
  )
}

export function createEntry(entry) {
  return addDoc(entriesRef, entry)
}

export function likeEntry(entryId) {
  return updateDoc(doc(db, 'entries', entryId), {
    likes: increment(1),
  })
}
