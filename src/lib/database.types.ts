// Generated from the Supabase project "icemaraton" (supabase gen types).
// Regenerate after every migration; don't edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      challenges: {
        Row: {
          category: string
          category_name: string
          clip_url: string | null
          done_at: string | null
          how: string
          id: number
          level: string
          scheduled_for: string | null
          status: string
          title: string
          votable: boolean
        }
        Insert: {
          category: string
          category_name: string
          clip_url?: string | null
          done_at?: string | null
          how: string
          id: number
          level: string
          scheduled_for?: string | null
          status?: string
          title: string
          votable?: boolean
        }
        Update: {
          category?: string
          category_name?: string
          clip_url?: string | null
          done_at?: string | null
          how?: string
          id?: number
          level?: string
          scheduled_for?: string | null
          status?: string
          title?: string
          votable?: boolean
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          currency: string | null
          doubled: boolean
          external_id: string | null
          id: number
          kind: string
          quantity: number
          seconds_added: number
          source: string
          tier: string | null
          user_id: string | null
          user_login: string | null
          user_name: string | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          doubled?: boolean
          external_id?: string | null
          id?: never
          kind: string
          quantity?: number
          seconds_added?: number
          source: string
          tier?: string | null
          user_id?: string | null
          user_login?: string | null
          user_name?: string | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          doubled?: boolean
          external_id?: string | null
          id?: never
          kind?: string
          quantity?: number
          seconds_added?: number
          source?: string
          tier?: string | null
          user_id?: string | null
          user_login?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          position: number
          threshold: number
          title: string
          unlocked_at: string | null
        }
        Insert: {
          position: number
          threshold: number
          title: string
          unlocked_at?: string | null
        }
        Update: {
          position?: number
          threshold?: number
          title?: string
          unlocked_at?: string | null
        }
        Relationships: []
      }
      prizes: {
        Row: {
          full_label: string
          is_win: boolean
          position: number
          short_label: string
          weight: number
          win_label: string
        }
        Insert: {
          full_label: string
          is_win?: boolean
          position: number
          short_label: string
          weight?: number
          win_label: string
        }
        Update: {
          full_label?: string
          is_win?: boolean
          position?: number
          short_label?: string
          weight?: number
          win_label?: string
        }
        Relationships: []
      }
      rates: {
        Row: {
          key: string
          label: string
          per: number
          seconds: number
        }
        Insert: {
          key: string
          label: string
          per?: number
          seconds: number
        }
        Update: {
          key?: string
          label?: string
          per?: number
          seconds?: number
        }
        Relationships: []
      }
      round_challenges: {
        Row: {
          challenge_id: number
          position: number
          round_id: number
          votes: number
        }
        Insert: {
          challenge_id: number
          position: number
          round_id: number
          votes?: number
        }
        Update: {
          challenge_id?: number
          position?: number
          round_id?: number
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "round_challenges_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_challenges_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "vote_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      spins: {
        Row: {
          created_at: string
          fulfilled_at: string | null
          id: number
          prize_position: number
          twitch_id: string
          user_login: string
        }
        Insert: {
          created_at?: string
          fulfilled_at?: string | null
          id?: never
          prize_position: number
          twitch_id: string
          user_login: string
        }
        Update: {
          created_at?: string
          fulfilled_at?: string | null
          id?: never
          prize_position?: number
          twitch_id?: string
          user_login?: string
        }
        Relationships: [
          {
            foreignKeyName: "spins_prize_position_fkey"
            columns: ["prize_position"]
            isOneToOne: false
            referencedRelation: "prizes"
            referencedColumns: ["position"]
          },
        ]
      }
      stats: {
        Row: {
          bits: number
          id: number
          raised: number
          subs: number
          updated_at: string
        }
        Insert: {
          bits?: number
          id?: number
          raised?: number
          subs?: number
          updated_at?: string
        }
        Update: {
          bits?: number
          id?: number
          raised?: number
          subs?: number
          updated_at?: string
        }
        Relationships: []
      }
      suggestions: {
        Row: {
          body: string
          created_at: string
          id: number
          status: string
          viewer_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: never
          status?: string
          viewer_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: never
          status?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      timer: {
        Row: {
          double_from: string | null
          double_until: string | null
          ends_at: string | null
          id: number
          paused_until: string | null
          scheduled_end: string | null
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          double_from?: string | null
          double_until?: string | null
          ends_at?: string | null
          id?: number
          paused_until?: string | null
          scheduled_end?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          double_from?: string | null
          double_until?: string | null
          ends_at?: string | null
          id?: number
          paused_until?: string | null
          scheduled_end?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      viewers: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_moderator: boolean
          is_subscriber: boolean
          login: string | null
          sub_checked_at: string | null
          sub_tier: string | null
          twitch_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_moderator?: boolean
          is_subscriber?: boolean
          login?: string | null
          sub_checked_at?: string | null
          sub_tier?: string | null
          twitch_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_moderator?: boolean
          is_subscriber?: boolean
          login?: string | null
          sub_checked_at?: string | null
          sub_tier?: string | null
          twitch_id?: string | null
        }
        Relationships: []
      }
      vote_rounds: {
        Row: {
          closes_at: string
          id: number
          number: number
          opens_at: string
          winner_id: number | null
        }
        Insert: {
          closes_at: string
          id?: never
          number: number
          opens_at?: string
          winner_id?: number | null
        }
        Update: {
          closes_at?: string
          id?: never
          number?: number
          opens_at?: string
          winner_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vote_rounds_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          challenge_id: number
          round_id: number
          updated_at: string
          viewer_id: string
        }
        Insert: {
          challenge_id: number
          round_id: number
          updated_at?: string
          viewer_id: string
        }
        Update: {
          challenge_id?: number
          round_id?: number
          updated_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_round_id_challenge_id_fkey"
            columns: ["round_id", "challenge_id"]
            isOneToOne: false
            referencedRelation: "round_challenges"
            referencedColumns: ["round_id", "challenge_id"]
          },
          {
            foreignKeyName: "votes_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_time: {
        Row: {
          display_name: string | null
          flakes: number
          login: string
          minutes: number
          minutes_to_flake: number
          twitch_id: string
          updated_at: string
        }
        Insert: {
          display_name?: string | null
          flakes?: number
          login: string
          minutes?: number
          minutes_to_flake?: number
          twitch_id: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          flakes?: number
          login?: string
          minutes?: number
          minutes_to_flake?: number
          twitch_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard_bits: {
        Row: {
          total: number | null
          user_login: string | null
          user_name: string | null
        }
        Relationships: []
      }
      leaderboard_donations: {
        Row: {
          total: number | null
          user_login: string | null
          user_name: string | null
        }
        Relationships: []
      }
      leaderboard_gifts: {
        Row: {
          total: number | null
          user_login: string | null
          user_name: string | null
        }
        Relationships: []
      }
      leaderboard_hours: {
        Row: {
          total: number | null
          user_login: string | null
          user_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cast_vote: {
        Args: { p_challenge: number; p_round: number }
        Returns: undefined
      }
      credit_watch_time: {
        Args: { p_minutes?: number; p_viewers: Json }
        Returns: number
      }
      freeze_timer: {
        Args: { p_seconds?: number }
        Returns: Database["public"]["Tables"]["timer"]["Row"]
      }
      record_event: {
        Args: {
          p_currency?: string
          p_external_id?: string
          p_kind: string
          p_quantity?: number
          p_seconds?: number
          p_source: string
          p_tier?: string
          p_user_id?: string
          p_user_login?: string
          p_user_name?: string
        }
        Returns: Database["public"]["Tables"]["events"]["Row"]
      }
      set_double_hour: {
        Args: { p_from: string; p_minutes?: number }
        Returns: Database["public"]["Tables"]["timer"]["Row"]
      }
      spin: {
        Args: never
        Returns: {
          full_label: string
          is_win: boolean
          prize_position: number
          spin_id: number
          spins_left: number
        }[]
      }
      start_timer: {
        Args: { p_scheduled_end?: string; p_seconds: number }
        Returns: Database["public"]["Tables"]["timer"]["Row"]
      }
      suggest: { Args: { p_body: string }; Returns: number }
      wheel_status: {
        Args: never
        Returns: {
          is_subscriber: boolean
          minutes_needed: number
          minutes_today: number
          spins_available: number
          spun_today: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])> =
  (PublicSchema["Tables"] & PublicSchema["Views"])[T] extends { Row: infer R } ? R : never
