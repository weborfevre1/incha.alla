/**
 * @siggistore/auth
 *
 * Shared authentication module for both storefront and admin.
 *
 * Role-based access control:
 *   - customer    → can access storefront only
 *   - admin       → can access both storefront and admin dashboard
 *   - seller      → can access both storefront and admin dashboard
 *
 * The same Supabase auth session is shared across both apps via
 * the shared @siggistore/supabase client with persistSession: true.
 */
import { getSupabase } from '@siggistore/supabase';
import type {
  AuthUser,
  AuthSession,
  UnifiedAuthState,
  UserRole,
  ApiResponse,
  SupabaseUser,
} from '@siggistore/shared-types';

// ===== AUTH STATE RESOLUTION =====

/**
 * Resolve the current auth state including user role from profiles table.
 * This is the core function that both apps use to determine auth status.
 */
export async function resolveAuthState(sessionOverride?: any): Promise<UnifiedAuthState> {
  const supabase = getSupabase();

  let session: any;
  if (sessionOverride !== undefined) {
    session = sessionOverride;
  } else {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  }

  if (!session?.user) {
    return {
      status: 'signed_out',
      session: null,
      user: null,
    };
  }

  // Fetch user role from profiles table
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, email, first_name, last_name, avatar_url')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user profile:', error);
    // Still return authenticated but without role - default to customer
    return {
      status: 'authenticated',
      session: mapSession(session),
      user: mapUser(session.user, null),
    };
  }

  return {
    status: 'authenticated',
    session: mapSession(session),
    user: mapUser(session.user, profile),
  };
}

/**
 * Check if the current user has admin or seller access.
 * Use this to determine if the "Dashboard" button should be shown.
 */
export async function hasAdminAccess(sessionOverride?: any): Promise<boolean> {
  const state = await resolveAuthState(sessionOverride);
  if (state.status !== 'authenticated' || !state.user) {
    return false;
  }
  return state.user.role === 'admin' || state.user.role === 'seller';
}

/**
 * Get the current user's role.
 */
export async function getCurrentUserRole(sessionOverride?: any): Promise<UserRole | null> {
  const state = await resolveAuthState(sessionOverride);
  return state.user?.role ?? null;
}

// ===== AUTH OPERATIONS =====

export async function signIn(email: string, password: string): Promise<ApiResponse<AuthUser>> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { success: false, error: error.message };
    }

    const state = await resolveAuthState(data.session);
    return { success: true, data: state.user! };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function signUp(email: string, password: string, metadata?: Record<string, any>): Promise<ApiResponse<AuthUser>> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: metadata ? { data: metadata } : undefined,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data.user ? mapUser(data.user as any, null) : null! };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function signOut(): Promise<ApiResponse<void>> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signOut({ scope: 'global' });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function resetPassword(email: string): Promise<ApiResponse<void>> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function updatePassword(newPassword: string): Promise<ApiResponse<void>> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ===== SESSION MANAGEMENT =====

export async function getSession(): Promise<AuthSession | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session ? mapSession(data.session) : null;
}

export function onAuthStateChange(callback: (state: UnifiedAuthState) => void) {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      callback({
        status: 'signed_out',
        session: null,
        user: null,
      });
      return;
    }

    // Re-resolve the full auth state (including role) when session changes
    const state = await resolveAuthState(session);
    callback(state);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}

// ===== HELPERS =====

function mapSession(session: any): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}

function mapUser(supabaseUser: SupabaseUser, profile: any): AuthUser {
  return {
    id: supabaseUser.id,
    email: profile?.email ?? supabaseUser.email ?? '',
    role: (profile?.role as UserRole) || 'customer',
    firstName: profile?.first_name ?? supabaseUser.user_metadata?.first_name ?? '',
    lastName: profile?.last_name ?? supabaseUser.user_metadata?.last_name ?? '',
    avatarUrl: profile?.avatar_url ?? supabaseUser.user_metadata?.avatar_url ?? '',
  };
}

// ===== EXPORTS =====
export type { AuthUser, AuthSession, UnifiedAuthState, UserRole };
