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
      advent_days: {
        Row: {
          clip_url: string | null
          day: number
          note: string | null
          sponsor: string | null
        }
        Insert: {
          clip_url?: string | null
          day: number
          note?: string | null
          sponsor?: string | null
        }
        Update: {
          clip_url?: string | null
          day?: number
          note?: string | null
          sponsor?: string | null
        }
        Relationships: []
      }
      bingo_draws: {
        Row: {
          drawn_at: string
          id: number
          login: string
          viewer_id: string | null
        }
        Insert: {
          drawn_at?: string
          id?: never
          login: string
          viewer_id?: string | null
        }
        Update: {
          drawn_at?: string
          id?: never
          login?: string
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bingo_draws_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_items: {
        Row: {
          happened_at: string | null
          id: number
          label: string
          position: number
        }
        Insert: {
          happened_at?: string | null
          id?: never
          label: string
          position: number
        }
        Update: {
          happened_at?: string | null
          id?: never
          label?: string
          position?: number
        }
        Relationships: []
      }
      bingo_picks: {
        Row: {
          items: number[]
          updated_at: string
          viewer_id: string
        }
        Insert: {
          items: number[]
          updated_at?: string
          viewer_id: string
        }
        Update: {
          items?: number[]
          updated_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bingo_picks_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_settings: {
        Row: {
          closes_at: string | null
          id: number
          prize: string
          prize_sponsor: string | null
        }
        Insert: {
          closes_at?: string | null
          id?: number
          prize?: string
          prize_sponsor?: string | null
        }
        Update: {
          closes_at?: string | null
          id?: number
          prize?: string
          prize_sponsor?: string | null
        }
        Relationships: []
      }
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
      code_attempts: {
        Row: {
          at: string
          viewer_id: string
        }
        Insert: {
          at?: string
          viewer_id: string
        }
        Update: {
          at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_attempts_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      code_claims: {
        Row: {
          claimed_at: string
          code_id: number
          viewer_id: string
        }
        Insert: {
          claimed_at?: string
          code_id: number
          viewer_id: string
        }
        Update: {
          claimed_at?: string
          code_id?: number
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_claims_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "secret_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_claims_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "viewers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_goals: {
        Row: {
          hours: number
          position: number
          title: string
        }
        Insert: {
          hours: number
          position: number
          title: string
        }
        Update: {
          hours?: number
          position?: number
          title?: string
        }
        Relationships: []
      }
      double_hours: {
        Row: {
          created_at: string
          ends_at: string
          id: number
          sponsor: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: never
          sponsor?: string | null
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: never
          sponsor?: string | null
          starts_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          bubble_line: string | null
          chat_at: string | null
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
          bubble_line?: string | null
          chat_at?: string | null
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
          bubble_line?: string | null
          chat_at?: string | null
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
          clip_url: string | null
          done_at: string | null
          position: number
          scheduled_for: string | null
          sponsor: string | null
          threshold: number
          title: string
          unlocked_at: string | null
        }
        Insert: {
          clip_url?: string | null
          done_at?: string | null
          position: number
          scheduled_for?: string | null
          sponsor?: string | null
          threshold: number
          title: string
          unlocked_at?: string | null
        }
        Update: {
          clip_url?: string | null
          done_at?: string | null
          position?: number
          scheduled_for?: string | null
          sponsor?: string | null
          threshold?: number
          title?: string
          unlocked_at?: string | null
        }
        Relationships: []
      }
      iceman_lines: {
        Row: {
          grp: string
          line: string
          position: number
        }
        Insert: {
          grp: string
          line: string
          position: number
        }
        Update: {
          grp?: string
          line?: string
          position?: number
        }
        Relationships: []
      }
      prizes: {
        Row: {
          full_label: string
          is_win: boolean
          position: number
          short_label: string
          sponsor: string | null
          weight: number
          win_label: string
        }
        Insert: {
          full_label: string
          is_win?: boolean
          position: number
          short_label: string
          sponsor?: string | null
          weight?: number
          win_label: string
        }
        Update: {
          full_label?: string
          is_win?: boolean
          position?: number
          short_label?: string
          sponsor?: string | null
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
      secret_codes: {
        Row: {
          code: string
          created_by: string | null
          expires_at: string
          id: number
          shown_at: string
          sponsor: string | null
        }
        Insert: {
          code: string
          created_by?: string | null
          expires_at: string
          id?: never
          shown_at?: string
          sponsor?: string | null
        }
        Update: {
          code?: string
          created_by?: string | null
          expires_at?: string
          id?: never
          shown_at?: string
          sponsor?: string | null
        }
        Relationships: []
      }
      spins: {
        Row: {
          bonus: boolean
          created_at: string
          fulfilled_at: string | null
          id: number
          prize_position: number
          twitch_id: string
          user_login: string
        }
        Insert: {
          bonus?: boolean
          created_at?: string
          fulfilled_at?: string | null
          id?: never
          prize_position: number
          twitch_id: string
          user_login: string
        }
        Update: {
          bonus?: boolean
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
      sponsor_stats: {
        Row: {
          count: number
          day: string
          kind: string
          sponsor: string
        }
        Insert: {
          count?: number
          day?: string
          kind: string
          sponsor: string
        }
        Update: {
          count?: number
          day?: string
          kind?: string
          sponsor?: string
        }
        Relationships: []
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
      stream_samples: {
        Row: {
          at: string
          chatters: number
        }
        Insert: {
          at?: string
          chatters: number
        }
        Update: {
          at?: string
          chatters?: number
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
          double_sponsor: string | null
          double_until: string | null
          ends_at: string | null
          id: number
          paused_until: string | null
          scheduled_end: string | null
          starts_at: string | null
          status: string
          stream_online: boolean
          updated_at: string
        }
        Insert: {
          double_from?: string | null
          double_sponsor?: string | null
          double_until?: string | null
          ends_at?: string | null
          id?: number
          paused_until?: string | null
          scheduled_end?: string | null
          starts_at?: string | null
          status?: string
          stream_online?: boolean
          updated_at?: string
        }
        Update: {
          double_from?: string | null
          double_sponsor?: string | null
          double_until?: string | null
          ends_at?: string | null
          id?: number
          paused_until?: string | null
          scheduled_end?: string | null
          starts_at?: string | null
          status?: string
          stream_online?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      viewers: {
        Row: {
          bonus_spins: number
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
          bonus_spins?: number
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
          bonus_spins?: number
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
      watch_daily: {
        Row: {
          day: string
          minutes: number
          twitch_id: string
        }
        Insert: {
          day: string
          minutes?: number
          twitch_id: string
        }
        Update: {
          day?: string
          minutes?: number
          twitch_id?: string
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      bingo_save: { Args: { p_items: number[] }; Returns: undefined }
      bingo_stats: {
        Args: never
        Returns: {
          players: number
        }[]
      }
      cast_vote: {
        Args: { p_challenge: number; p_round: number }
        Returns: undefined
      }
      chat_line_claim: { Args: { p_event: number }; Returns: string }
      claim_code: { Args: { p_code: string }; Returns: Json }
      credit_watch_time: {
        Args: { p_minutes?: number; p_viewers: Json }
        Returns: number
      }
      feed_since: { Args: { p_after: number; p_limit?: number }; Returns: Json }
      freeze_timer: {
        Args: { p_seconds?: number }
        Returns: {
          double_from: string | null
          double_sponsor: string | null
          double_until: string | null
          ends_at: string | null
          id: number
          paused_until: string | null
          scheduled_end: string | null
          starts_at: string | null
          status: string
          stream_online: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "timer"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_moderator: { Args: never; Returns: boolean }
      mod_add_time: { Args: { p_minutes: number }; Returns: undefined }
      mod_bingo_draw: { Args: never; Returns: string }
      mod_bingo_set_items: { Args: { p_items: Json }; Returns: undefined }
      mod_bingo_settings: {
        Args: { p_closes_at: string; p_prize: string; p_prize_sponsor?: string }
        Returns: undefined
      }
      mod_bingo_status: { Args: never; Returns: Json }
      mod_bingo_tick: {
        Args: { p_happened: boolean; p_id: number }
        Returns: undefined
      }
      mod_chat_status: { Args: never; Returns: Json }
      mod_close_round: { Args: { p_round: number }; Returns: number }
      mod_code_end: { Args: never; Returns: undefined }
      mod_code_show: {
        Args: { p_minutes?: number; p_sponsor: string }
        Returns: Json
      }
      mod_codes: { Args: never; Returns: Json }
      mod_double_hour: {
        Args: { p_from: string; p_minutes?: number; p_sponsor?: string }
        Returns: undefined
      }
      mod_end_timer: { Args: never; Returns: undefined }
      mod_freeze: { Args: { p_minutes: number }; Returns: undefined }
      mod_freeze_until: { Args: { p_until: string }; Returns: undefined }
      mod_fulfil_spin: { Args: { p_id: number }; Returns: undefined }
      mod_health: { Args: never; Returns: Json }
      mod_name_rule: {
        Args: { p_name: string; p_rule: string }
        Returns: undefined
      }
      mod_names: { Args: never; Returns: Json }
      mod_open_round: {
        Args: { p_challenges: number[]; p_minutes: number }
        Returns: number
      }
      mod_overlay_key: { Args: never; Returns: string }
      mod_review_suggestion: {
        Args: { p_approve: boolean; p_id: number }
        Returns: number
      }
      mod_set_advent: { Args: { p_days: Json }; Returns: undefined }
      mod_set_challenge: {
        Args: {
          p_clip?: string
          p_id: number
          p_scheduled_for?: string
          p_status: string
        }
        Returns: undefined
      }
      mod_set_chat_echo: { Args: { p_on: boolean }; Returns: undefined }
      mod_set_community_goals: { Args: { p_goals: Json }; Returns: undefined }
      mod_set_goals: { Args: { p_goals: Json }; Returns: undefined }
      mod_set_lines: {
        Args: { p_lines: Json; p_small_donation?: number }
        Returns: undefined
      }
      mod_set_moderator: {
        Args: { p_login: string; p_on: boolean }
        Returns: undefined
      }
      mod_set_note: {
        Args: { p_minutes?: number; p_note: string }
        Returns: undefined
      }
      mod_set_prizes: { Args: { p_prizes: Json }; Returns: undefined }
      mod_set_schedule: {
        Args: { p_scheduled_end: string; p_starts_at: string }
        Returns: undefined
      }
      mod_sponsor_report: { Args: never; Returns: Json }
      mod_start_timer: {
        Args: { p_hours: number; p_scheduled_end?: string }
        Returns: undefined
      }
      mod_status: { Args: never; Returns: Json }
      mod_unfreeze: { Args: never; Returns: undefined }
      my_state: { Args: { p_round?: number }; Returns: Json }
      name_blocked: { Args: { p: string }; Returns: boolean }
      overlay_code: {
        Args: { p_key: string }
        Returns: {
          code: string
          expires_at: string
          sponsor: string
        }[]
      }
      public_name: {
        Args: { p_login: string; p_name: string }
        Returns: string
      }
      public_state: { Args: { p_have?: Json }; Returns: Json }
      record_checkin: {
        Args: { p_login: string; p_name: string; p_user_id: string }
        Returns: boolean
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
        Returns: {
          bubble_line: string | null
          chat_at: string | null
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
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_broadcaster_token: { Args: { p_token: Json }; Returns: undefined }
      save_stream_info: {
        Args: {
          p_game: string
          p_started_at: string
          p_title: string
          p_viewers: number
        }
        Returns: undefined
      }
      save_stream_title: {
        Args: { p_game: string; p_title: string }
        Returns: undefined
      }
      set_double_hour: {
        Args: { p_from: string; p_minutes?: number }
        Returns: {
          double_from: string | null
          double_sponsor: string | null
          double_until: string | null
          ends_at: string | null
          id: number
          paused_until: string | null
          scheduled_end: string | null
          starts_at: string | null
          status: string
          stream_online: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "timer"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_public_name: { Args: { p_public: boolean }; Returns: boolean }
      set_stream_online: { Args: { p_online: boolean }; Returns: undefined }
      set_viewer_sub: {
        Args: { p_is_sub: boolean; p_tier: string; p_viewer: string }
        Returns: undefined
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
        Returns: {
          double_from: string | null
          double_sponsor: string | null
          double_until: string | null
          ends_at: string | null
          id: number
          paused_until: string | null
          scheduled_end: string | null
          starts_at: string | null
          status: string
          stream_online: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "timer"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      suggest: { Args: { p_body: string }; Returns: number }
      tipeee_config: { Args: never; Returns: Json }
      tipeee_mark: {
        Args: { p_count: number; p_error: string; p_since: string }
        Returns: undefined
      }
      track_sponsor: {
        Args: { p_kind: string; p_sponsor: string }
        Returns: undefined
      }
      twitch_config: { Args: never; Returns: Json }
      wheel_status: {
        Args: never
        Returns: {
          bonus_spins: number
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
