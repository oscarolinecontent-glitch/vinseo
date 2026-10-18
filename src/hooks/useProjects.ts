'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore/lite';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebaseDb';
import type { Project } from '@/lib/types';
import { errorMessage } from '@/lib/types';

export function useProjects() {
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ uid: string; projects: Project[]; error: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    let active = true;
    getDocs(collection(db, 'users', user.uid, 'projects')).then(snapshot => {
      if (active) setResult({ uid: user.uid, projects: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Project)), error: '' });
    }).catch(error => {
      if (active) setResult({ uid: user.uid, projects: [], error: errorMessage(error) });
    });
    return () => { active = false; };
  }, [user, revision]);
  const current = result?.uid === user?.uid ? result : null;
  return { reload: () => setRevision(value => value + 1), projects: current?.projects ?? [], loading: !!user && !current, error: current?.error ?? '' };
}
