/**
 * Storefront Supabase Service
 *
 * Wraps the shared @siggistore/auth and @siggistore/supabase packages
 * to provide the storefront-specific API surface.
 */
import { getSupabase } from '@siggistore/supabase';
import { signIn, signUp, signOut, resetPassword, updatePassword } from '@siggistore/auth';
import type {
  SupabaseUser,
  SupabaseProfile,
  SupabaseOrder,
  ApiResponse,
} from '@siggistore/shared-types';

const supabase = getSupabase();

export const supabaseAuthService = {
  async signUp(email: string, password: string): Promise<ApiResponse<SupabaseUser>> {
    const result = await signUp(email, password);
    if (result.success && result.data) {
      return {
        success: true,
        data: {
          id: result.data.id,
          email: result.data.email,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as SupabaseUser,
      };
    }
    return { success: false, error: result.error };
  },

  async signIn(email: string, password: string): Promise<ApiResponse<SupabaseUser>> {
    const result = await signIn(email, password);
    if (result.success && result.data) {
      const { data: sessionData } = await supabase.auth.getSession();
      return {
        success: true,
        data: (sessionData.session?.user as SupabaseUser) || (result.data as unknown as SupabaseUser),
      };
    }
    return { success: false, error: result.error };
  },

  async signOut(): Promise<ApiResponse<void>> {
    return signOut();
  },

  async getCurrentUser(): Promise<SupabaseUser | null> {
    try {
      const { data } = await supabase.auth.getSession();
      return (data.session?.user as SupabaseUser) || null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  },

  async resetPassword(email: string): Promise<ApiResponse<void>> {
    return resetPassword(email);
  },

  async updatePassword(newPassword: string): Promise<ApiResponse<void>> {
    return updatePassword(newPassword);
  },

  async uploadAvatar(userId: string, file: File): Promise<ApiResponse<string>> {
    try {
      const fileName = `${Date.now()}-${file.name}`;
      const path = `${userId}/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file);
      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: urlData.publicUrl },
      });

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      return { success: true, data: urlData.publicUrl };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  onAuthStateChange(callback: (user: SupabaseUser | null) => void) {
    return supabase.auth.onAuthStateChange(async (_event, session) => {
      callback((session?.user as SupabaseUser) || null);
    });
  },
};

export const supabaseProfileService = {
  async getProfile(userId: string): Promise<ApiResponse<SupabaseProfile>> {
    try {
      const { data, error } = await supabase.from('profiles').select().eq('user_id', userId).single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async createProfile(
    profile: Omit<SupabaseProfile, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<ApiResponse<SupabaseProfile>> {
    try {
      const { data, error } = await supabase.from('profiles').insert(profile).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async upsertProfile(userId: string, profile: Partial<SupabaseProfile>): Promise<ApiResponse<SupabaseProfile>> {
    try {
      const { data, error } = await supabase.from('profiles').upsert({ user_id: userId, ...profile }).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async deleteProfile(userId: string): Promise<ApiResponse<void>> {
    try {
      const { error } = await supabase.from('profiles').delete().eq('user_id', userId);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};

export const supabaseOrderService = {
  async getOrders(userId: string): Promise<ApiResponse<SupabaseOrder[]>> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select()
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return { success: false, error: error.message };
      return { success: true, data: (data || []) as SupabaseOrder[] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async getOrder(orderId: string): Promise<ApiResponse<SupabaseOrder>> {
    try {
      const { data, error } = await supabase.from('orders').select().eq('id', orderId).single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async createOrder(
    order: Omit<SupabaseOrder, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<ApiResponse<SupabaseOrder>> {
    try {
      const { data, error } = await supabase.from('orders').insert([order]).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async updateOrder(orderId: string, updates: Partial<SupabaseOrder>): Promise<ApiResponse<SupabaseOrder>> {
    try {
      const { data, error } = await supabase.from('orders').update(updates).eq('id', orderId).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};

export const supabaseCartService = {
  async saveCart(userId: string, items: any[]): Promise<ApiResponse<void>> {
    try {
      const { error } = await supabase
        .from('carts')
        .upsert({ user_id: userId, items, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async getCart(userId: string): Promise<ApiResponse<any>> {
    try {
      const { data, error } = await supabase.from('carts').select().eq('user_id', userId).single();
      if (error && error.code !== 'PGRST116') {
        return { success: false, error: error.message };
      }
      return { success: true, data: data || { items: [] } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async clearCart(userId: string): Promise<ApiResponse<void>> {
    try {
      const { error } = await supabase.from('carts').delete().eq('user_id', userId);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};

export default {
  auth: supabaseAuthService,
  profile: supabaseProfileService,
  order: supabaseOrderService,
  cart: supabaseCartService,
};
