import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

const ALLOWED_VEHICLES = new Set([
  'street_falcon',
  'sand_runner',
  'night_viper',
  'cyber_gtr',
  'phantom_x',
]);

function sanitizeDisplayName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : 'Driver';
}

function sanitizeVehicleId(id: string): string {
  return ALLOWED_VEHICLES.has(id) ? id : 'street_falcon';
}

function sanitizeModList(mods: string[]): string[] {
  return mods
    .filter((m) => typeof m === 'string' && m.trim().length > 0)
    .map((m) => m.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40))
    .filter(Boolean)
    .slice(0, 3);
}

function sanitizeUnlockedVehicles(vehicles: string[]): string[] {
  const unique = Array.from(new Set(vehicles.filter((v) => ALLOWED_VEHICLES.has(v)))).slice(0, 10);
  return unique.length > 0 ? unique : ['street_falcon'];
}

export interface CloudDriverProfilePayload {
  displayName: string;
  selectedVehicleId: string;
  careerLights: number;
  careerReputation: number;
  offlineCredits: number;
  unlockedVehicles: string[];
  equippedMods: string[];
  prestigeTier: number;
}

export interface CloudCareerEventPayload {
  eventId: string;
  groupId: string;
  bestPosition: number;
  bestScore: number;
  bestTimeMs: number;
  lightsEarned: number;
  fanRunCompleted: boolean;
  fanDemandCompleted: boolean;
}

export interface CloudVehicleMasteryPayload {
  vehicleId: string;
  racesCompleted: number;
  wins: number;
  distanceMeters: number;
  bestLapMs: number;
  combatActions: number;
  defensiveActions: number;
  masteryLevel: number;
}

export async function signInWithGoogleDriver(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutGoogleDriver(): Promise<void> {
  await signOut(auth);
}

export function subscribeDriverAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function loadCloudDriverProfile(uid: string): Promise<CloudDriverProfilePayload | null> {
  const path = `drivers/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'drivers', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      displayName: sanitizeDisplayName(String(d.displayName ?? 'Driver')),
      selectedVehicleId: sanitizeVehicleId(String(d.selectedVehicleId ?? 'street_falcon')),
      careerLights: Math.max(0, Math.min(500, Math.floor(Number(d.careerLights ?? 0)))),
      careerReputation: Math.max(0, Math.min(10000000, Math.floor(Number(d.careerReputation ?? 0)))),
      offlineCredits: Math.max(0, Math.min(100000000, Math.floor(Number(d.offlineCredits ?? 0)))),
      unlockedVehicles: sanitizeUnlockedVehicles(Array.isArray(d.unlockedVehicles) ? d.unlockedVehicles : ['street_falcon']),
      equippedMods: sanitizeModList(Array.isArray(d.equippedMods) ? d.equippedMods : []),
      prestigeTier: Math.max(0, Math.min(10, Math.floor(Number(d.prestigeTier ?? 0)))),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function syncCloudDriverProfile(
  uid: string,
  payload: CloudDriverProfilePayload
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid || !auth.currentUser.emailVerified) {
    return;
  }
  const path = `drivers/${uid}`;
  const ref = doc(db, 'drivers', uid);
  const sanitized = {
    displayName: sanitizeDisplayName(payload.displayName),
    selectedVehicleId: sanitizeVehicleId(payload.selectedVehicleId),
    careerLights: Math.max(0, Math.min(500, Math.floor(payload.careerLights))),
    careerReputation: Math.max(0, Math.min(10000000, Math.floor(payload.careerReputation))),
    offlineCredits: Math.max(0, Math.min(100000000, Math.floor(payload.offlineCredits))),
    unlockedVehicles: sanitizeUnlockedVehicles(payload.unlockedVehicles),
    equippedMods: sanitizeModList(payload.equippedMods),
    prestigeTier: Math.max(0, Math.min(10, Math.floor(payload.prestigeTier))),
  };
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...sanitized,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadCloudCareerEvents(uid: string): Promise<CloudCareerEventPayload[]> {
  const path = `drivers/${uid}/careerEvents`;
  try {
    const q = query(collection(db, 'drivers', uid, 'careerEvents'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        eventId: String(d.eventId ?? docSnap.id),
        groupId: String(d.groupId ?? 'street_initiation'),
        bestPosition: Math.max(1, Math.min(20, Math.floor(Number(d.bestPosition ?? 1)))),
        bestScore: Math.max(0, Math.min(1000000, Math.floor(Number(d.bestScore ?? 0)))),
        bestTimeMs: Math.max(0, Math.min(3600000, Math.floor(Number(d.bestTimeMs ?? 0)))),
        lightsEarned: Math.max(0, Math.min(5, Math.floor(Number(d.lightsEarned ?? 0)))),
        fanRunCompleted: Boolean(d.fanRunCompleted),
        fanDemandCompleted: Boolean(d.fanDemandCompleted),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncCloudCareerEvent(
  uid: string,
  payload: CloudCareerEventPayload
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid || !auth.currentUser.emailVerified) {
    return;
  }
  const cleanEventId = payload.eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const cleanGroupId = payload.groupId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (cleanEventId.length < 2 || cleanGroupId.length < 2) return;

  const path = `drivers/${uid}/careerEvents/${cleanEventId}`;
  const ref = doc(db, 'drivers', uid, 'careerEvents', cleanEventId);
  try {
    const existingSnap = await getDoc(ref);
    const prevLights = existingSnap.exists() ? Math.floor(Number(existingSnap.data().lightsEarned ?? 0)) : 0;
    const clamped = {
      bestPosition: Math.max(1, Math.min(20, Math.floor(payload.bestPosition))),
      bestScore: Math.max(0, Math.min(1000000, Math.floor(payload.bestScore))),
      bestTimeMs: Math.max(0, Math.min(3600000, Math.floor(payload.bestTimeMs))),
      lightsEarned: Math.max(prevLights, Math.max(0, Math.min(5, Math.floor(payload.lightsEarned)))),
      fanRunCompleted: Boolean(payload.fanRunCompleted),
      fanDemandCompleted: Boolean(payload.fanDemandCompleted),
    };
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        eventId: cleanEventId,
        groupId: cleanGroupId,
        ...clamped,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...clamped,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncCloudVehicleMastery(
  uid: string,
  payload: CloudVehicleMasteryPayload
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid || !auth.currentUser.emailVerified) {
    return;
  }
  const cleanVehicleId = sanitizeVehicleId(payload.vehicleId);
  const path = `drivers/${uid}/vehicleMastery/${cleanVehicleId}`;
  const ref = doc(db, 'drivers', uid, 'vehicleMastery', cleanVehicleId);
  try {
    const existingSnap = await getDoc(ref);
    const prev = existingSnap.exists() ? existingSnap.data() : null;
    const racesCompleted = Math.max(
      prev ? Math.floor(Number(prev.racesCompleted ?? 0)) : 0,
      Math.max(0, Math.min(100000, Math.floor(payload.racesCompleted)))
    );
    const wins = Math.min(
      racesCompleted,
      Math.max(
        prev ? Math.floor(Number(prev.wins ?? 0)) : 0,
        Math.max(0, Math.min(100000, Math.floor(payload.wins)))
      )
    );
    const distanceMeters = Math.max(
      prev ? Math.floor(Number(prev.distanceMeters ?? 0)) : 0,
      Math.max(0, Math.min(1000000000, Math.floor(payload.distanceMeters)))
    );
    const clamped = {
      racesCompleted,
      wins,
      distanceMeters,
      bestLapMs: Math.max(0, Math.min(3600000, Math.floor(payload.bestLapMs))),
      combatActions: Math.max(0, Math.min(1000000, Math.floor(payload.combatActions))),
      defensiveActions: Math.max(0, Math.min(1000000, Math.floor(payload.defensiveActions))),
      masteryLevel: Math.max(1, Math.min(10, Math.floor(payload.masteryLevel))),
    };
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        vehicleId: cleanVehicleId,
        ...clamped,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...clamped,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
