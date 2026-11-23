export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_counters: {
        Row: {
          action: string
          count: number
          created_at: string
          region: string
          subject_id: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string
          region: string
          subject_id: string
          window_start: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string
          region?: string
          subject_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_counters_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      addons: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          id: string
          name: Json
          price: number
          region: string
          service_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          name: Json
          price: number
          region: string
          service_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          name?: Json
          price?: number
          region?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addons_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "addons_service_fk"
            columns: ["service_id", "region"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      agreement_acceptances: {
        Row: {
          accepted_at: string
          application_id: string
          id: string
          region: string
          request_id: string
          role: string
          template_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          application_id: string
          id?: string
          region: string
          request_id: string
          role: string
          template_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          application_id?: string
          id?: string
          region?: string
          request_id?: string
          role?: string
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_acceptances_application_fk"
            columns: ["application_id", "request_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "agreement_acceptances_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "agreement_acceptances_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "agreement_acceptances_template_fk"
            columns: ["template_id", "region"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "agreement_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          active: boolean
          body: Json
          created_at: string
          id: string
          region: string
          version: string
        }
        Insert: {
          active?: boolean
          body: Json
          created_at?: string
          id?: string
          region: string
          version: string
        }
        Update: {
          active?: boolean
          body?: Json
          created_at?: string
          id?: string
          region?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      application_questions: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          display_order: number
          help_text: Json | null
          id: string
          key: string
          label: Json
          options: Json | null
          region: string
          required: boolean
          type: string
          validation: Json | null
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          display_order?: number
          help_text?: Json | null
          id?: string
          key: string
          label: Json
          options?: Json | null
          region: string
          required?: boolean
          type: string
          validation?: Json | null
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          display_order?: number
          help_text?: Json | null
          id?: string
          key?: string
          label?: Json
          options?: Json | null
          region?: string
          required?: boolean
          type?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "application_questions_category_fk"
            columns: ["category_id", "region"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "application_questions_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      applications: {
        Row: {
          answers: Json | null
          created_at: string
          fee_extended_at: string | null
          id: string
          message: string | null
          payment_extended_at: string | null
          provider_fee_amount: number | null
          provider_fee_kind: string | null
          provider_id: string
          questions_snapshot: Json | null
          region: string
          request_id: string
          status: string
          status_changed_at: string
          unlocked_at: string | null
        }
        Insert: {
          answers?: Json | null
          created_at?: string
          fee_extended_at?: string | null
          id?: string
          message?: string | null
          payment_extended_at?: string | null
          provider_fee_amount?: number | null
          provider_fee_kind?: string | null
          provider_id: string
          questions_snapshot?: Json | null
          region: string
          request_id: string
          status?: string
          status_changed_at?: string
          unlocked_at?: string | null
        }
        Update: {
          answers?: Json | null
          created_at?: string
          fee_extended_at?: string | null
          id?: string
          message?: string | null
          payment_extended_at?: string | null
          provider_fee_amount?: number | null
          provider_fee_kind?: string | null
          provider_id?: string
          questions_snapshot?: Json | null
          region?: string
          request_id?: string
          status?: string
          status_changed_at?: string
          unlocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_provider_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "applications_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "applications_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      apply_counters: {
        Row: {
          count: number
          provider_id: string
          region: string
          window_start: string
        }
        Insert: {
          count: number
          provider_id: string
          region: string
          window_start: string
        }
        Update: {
          count?: number
          provider_id?: string
          region?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "apply_counters_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_counters_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          new_value: Json | null
          old_value: Json | null
          region: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          region?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          region?: string | null
        }
        Relationships: []
      }
      cancellation_rules: {
        Row: {
          actor: string
          allowed: boolean
          commission_outcome: string
          counts_against: string
          provider_fee_outcome: string
          region: string
          state: string
        }
        Insert: {
          actor: string
          allowed: boolean
          commission_outcome: string
          counts_against: string
          provider_fee_outcome: string
          region: string
          state: string
        }
        Update: {
          actor?: string
          allowed?: boolean
          commission_outcome?: string
          counts_against?: string
          provider_fee_outcome?: string
          region?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_rules_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      checkout_attempts: {
        Row: {
          created_at: string
          failure_reason: string | null
          fee_payment_id: string
          finished_at: string | null
          id: string
          locale: string | null
          payer_ip: unknown
          psp_token: string | null
          region: string
          started_at: string
          status: string
          url: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          fee_payment_id: string
          finished_at?: string | null
          id?: string
          locale?: string | null
          payer_ip?: unknown
          psp_token?: string | null
          region: string
          started_at?: string
          status?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          fee_payment_id?: string
          finished_at?: string | null
          id?: string
          locale?: string | null
          payer_ip?: unknown
          psp_token?: string | null
          region?: string
          started_at?: string
          status?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_attempts_fee_fk"
            columns: ["fee_payment_id", "region"]
            isOneToOne: false
            referencedRelation: "fee_payments"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "checkout_attempts_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      deadline_flags: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          id: string
          kind: string
          note: string | null
          raised_at: string
          region: string
          request_id: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          id?: string
          kind: string
          note?: string | null
          raised_at?: string
          region: string
          request_id: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          raised_at?: string
          region?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deadline_flags_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadline_flags_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "deadline_flags_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      email_confirmations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          profile_id: string
          region: string
          revoked_at: string | null
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          profile_id: string
          region: string
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          profile_id?: string
          region?: string
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_confirmations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_confirmations_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      fake_psp_outcomes: {
        Row: {
          created_at: string
          outcome: Json
          region: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          outcome: Json
          region: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          outcome?: Json
          region?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fake_psp_outcomes_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      fee_payments: {
        Row: {
          amount: number
          application_id: string | null
          created_at: string
          currency: string
          id: string
          kind: string
          paid_at: string | null
          payer_id: string
          provider_id: string | null
          psp_fee_amount: number | null
          psp_payment_id: string | null
          region: string
          request_id: string
          status: string
        }
        Insert: {
          amount: number
          application_id?: string | null
          created_at?: string
          currency: string
          id?: string
          kind: string
          paid_at?: string | null
          payer_id: string
          provider_id?: string | null
          psp_fee_amount?: number | null
          psp_payment_id?: string | null
          region: string
          request_id: string
          status?: string
        }
        Update: {
          amount?: number
          application_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          paid_at?: string | null
          payer_id?: string
          provider_id?: string | null
          psp_fee_amount?: number | null
          psp_payment_id?: string | null
          region?: string
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_payments_application_fk"
            columns: ["application_id", "request_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "fee_payments_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_provider_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "fee_payments_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fee_payments_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      fee_refunds: {
        Row: {
          amount: number
          created_at: string
          currency: string
          fee_payment_id: string | null
          finished_at: string | null
          id: string
          kind: string
          psp_payment_id: string
          psp_refund_id: string | null
          reason: string | null
          region: string
          request_id: string
          requested_by: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          fee_payment_id?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          psp_payment_id: string
          psp_refund_id?: string | null
          reason?: string | null
          region: string
          request_id: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          fee_payment_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          psp_payment_id?: string
          psp_refund_id?: string | null
          reason?: string | null
          region?: string
          request_id?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_refunds_fee_fk"
            columns: ["fee_payment_id", "region"]
            isOneToOne: false
            referencedRelation: "fee_payments"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "fee_refunds_fee_request_fk"
            columns: ["fee_payment_id", "request_id"]
            isOneToOne: false
            referencedRelation: "fee_payments"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "fee_refunds_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fee_refunds_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "fee_refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account: string
          amount: number
          created_at: string
          currency: string
          id: number
          journal_id: string
          region: string
        }
        Insert: {
          account: string
          amount: number
          created_at?: string
          currency: string
          id?: never
          journal_id: string
          region: string
        }
        Update: {
          account?: string
          amount?: number
          created_at?: string
          currency?: string
          id?: never
          journal_id?: string
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_journal_fk"
            columns: ["journal_id", "region", "currency"]
            isOneToOne: false
            referencedRelation: "ledger_journals"
            referencedColumns: ["id", "region", "currency"]
          },
          {
            foreignKeyName: "ledger_entries_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      ledger_journals: {
        Row: {
          created_at: string
          currency: string
          fee_payment_id: string | null
          id: string
          idempotency_key: string
          kind: string
          legs: Json
          region: string
          response: Json
        }
        Insert: {
          created_at?: string
          currency: string
          fee_payment_id?: string | null
          id?: string
          idempotency_key: string
          kind: string
          legs: Json
          region: string
          response: Json
        }
        Update: {
          created_at?: string
          currency?: string
          fee_payment_id?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          legs?: Json
          region?: string
          response?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ledger_journals_fee_fk"
            columns: ["fee_payment_id", "region"]
            isOneToOne: false
            referencedRelation: "fee_payments"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "ledger_journals_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          region: string
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          email_enabled: boolean
          region: string
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          email_enabled?: boolean
          region?: string
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          deadline_at: string | null
          dedupe_key: string
          entity_id: string | null
          id: string
          kind: string
          read_at: string | null
          recipient_id: string
          region: string
          request_id: string | null
        }
        Insert: {
          created_at?: string
          deadline_at?: string | null
          dedupe_key: string
          entity_id?: string | null
          id?: string
          kind: string
          read_at?: string | null
          recipient_id: string
          region: string
          request_id?: string | null
        }
        Update: {
          created_at?: string
          deadline_at?: string | null
          dedupe_key?: string
          entity_id?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          recipient_id?: string
          region?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_events: {
        Row: {
          alerted_at: string | null
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          done_at: string | null
          id: string
          idempotency_key: string
          kind: string
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          region: string
          status: string
        }
        Insert: {
          alerted_at?: string | null
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          idempotency_key: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload: Json
          region: string
          status?: string
        }
        Update: {
          alerted_at?: string | null
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          region?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          region: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          region: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          region?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      pricing_formulas: {
        Row: {
          active: boolean
          base_price: number
          created_at: string
          created_by: string | null
          id: string
          region: string
          service_id: string
          version: number
        }
        Insert: {
          active?: boolean
          base_price: number
          created_at?: string
          created_by?: string | null
          id?: string
          region: string
          service_id: string
          version: number
        }
        Update: {
          active?: boolean
          base_price?: number
          created_at?: string
          created_by?: string | null
          id?: string
          region?: string
          service_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_formulas_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pricing_formulas_service_fk"
            columns: ["service_id", "region"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      pricing_modifiers: {
        Row: {
          amount: number | null
          apply_order: number
          created_at: string
          effect_type: string
          factor: number | null
          formula_id: string
          id: string
          match_type: string
          match_value: Json | null
          question_key: string | null
          region: string
        }
        Insert: {
          amount?: number | null
          apply_order: number
          created_at?: string
          effect_type: string
          factor?: number | null
          formula_id: string
          id?: string
          match_type: string
          match_value?: Json | null
          question_key?: string | null
          region: string
        }
        Update: {
          amount?: number | null
          apply_order?: number
          created_at?: string
          effect_type?: string
          factor?: number | null
          formula_id?: string
          id?: string
          match_type?: string
          match_value?: Json | null
          question_key?: string | null
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_modifiers_formula_fk"
            columns: ["formula_id", "region"]
            isOneToOne: false
            referencedRelation: "pricing_formulas"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "pricing_modifiers_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      probation_waivers: {
        Row: {
          created_at: string
          note: string
          provider_id: string
          region: string
          waived_by: string
        }
        Insert: {
          created_at?: string
          note: string
          provider_id: string
          region: string
          waived_by: string
        }
        Update: {
          created_at?: string
          note?: string
          provider_id?: string
          region?: string
          waived_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "probation_waivers_provider_region_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "probation_waivers_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "probation_waivers_waived_by_fkey"
            columns: ["waived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_reports: {
        Row: {
          admin_note: string | null
          against_id: string
          created_at: string
          fee_refund_id: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          outcome: string | null
          reason: string
          region: string
          reporter_id: string
          request_id: string
          side: string
          status: string
          text: string
        }
        Insert: {
          admin_note?: string | null
          against_id: string
          created_at?: string
          fee_refund_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          outcome?: string | null
          reason: string
          region: string
          reporter_id: string
          request_id: string
          side: string
          status?: string
          text: string
        }
        Update: {
          admin_note?: string | null
          against_id?: string
          created_at?: string
          fee_refund_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          outcome?: string | null
          reason?: string
          region?: string
          reporter_id?: string
          request_id?: string
          side?: string
          status?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_reports_against_id_fkey"
            columns: ["against_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_reports_fee_refund_id_fkey"
            columns: ["fee_refund_id"]
            isOneToOne: false
            referencedRelation: "fee_refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_reports_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_reports_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "problem_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_reports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          email_confirmed_at: string | null
          full_name: string
          id: string
          locale: string
          phone: string
          region: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_confirmed_at?: string | null
          full_name: string
          id: string
          locale: string
          phone: string
          region: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_confirmed_at?: string | null
          full_name?: string
          id?: string
          locale?: string
          phone?: string
          region?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      provider_availability: {
        Row: {
          end_hour: number
          provider_id: string
          region: string
          start_hour: number
          updated_at: string
          work_days: number[]
        }
        Insert: {
          end_hour: number
          provider_id: string
          region: string
          start_hour: number
          updated_at?: string
          work_days: number[]
        }
        Update: {
          end_hour?: number
          provider_id?: string
          region?: string
          start_hour?: number
          updated_at?: string
          work_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "provider_availability_provider_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "provider_availability_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      provider_documents: {
        Row: {
          id: string
          mime_type: string
          object_id: string
          provider_id: string
          region: string
          rejection_code: string | null
          rejection_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number
          status: string
          storage_path: string
          type: string
          uploaded_at: string
          valid_until: string | null
        }
        Insert: {
          id?: string
          mime_type: string
          object_id: string
          provider_id: string
          region: string
          rejection_code?: string | null
          rejection_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes: number
          status?: string
          storage_path: string
          type: string
          uploaded_at?: string
          valid_until?: string | null
        }
        Update: {
          id?: string
          mime_type?: string
          object_id?: string
          provider_id?: string
          region?: string
          rejection_code?: string | null
          rejection_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number
          status?: string
          storage_path?: string
          type?: string
          uploaded_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_documents_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_documents_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      provider_profiles: {
        Row: {
          bio: string
          created_at: string
          languages: string[]
          provider_id: string
          region: string
          updated_at: string
          years_experience: number
        }
        Insert: {
          bio: string
          created_at?: string
          languages: string[]
          provider_id: string
          region: string
          updated_at?: string
          years_experience: number
        }
        Update: {
          bio?: string
          created_at?: string
          languages?: string[]
          provider_id?: string
          region?: string
          updated_at?: string
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_profiles_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_profiles_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      provider_services: {
        Row: {
          created_at: string
          provider_id: string
          region: string
          service_id: string
        }
        Insert: {
          created_at?: string
          provider_id: string
          region: string
          service_id: string
        }
        Update: {
          created_at?: string
          provider_id?: string
          region?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_services_provider_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "provider_services_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "provider_services_service_fk"
            columns: ["service_id", "region"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      provider_zones: {
        Row: {
          created_at: string
          provider_id: string
          region: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          provider_id: string
          region: string
          zone_id: string
        }
        Update: {
          created_at?: string
          provider_id?: string
          region?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_zones_provider_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "provider_zones_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "provider_zones_zone_fk"
            columns: ["zone_id", "region"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      providers: {
        Row: {
          approved_at: string | null
          approved_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_type: string | null
          id: string
          legal_name: string | null
          region: string
          rejection_code: string | null
          rejection_note: string | null
          review_reason: string | null
          status: string
          submitted_at: string | null
          suspension_reason: string | null
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_type?: string | null
          id: string
          legal_name?: string | null
          region: string
          rejection_code?: string | null
          rejection_note?: string | null
          review_reason?: string | null
          status?: string
          submitted_at?: string | null
          suspension_reason?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_type?: string | null
          id?: string
          legal_name?: string | null
          region?: string
          rejection_code?: string | null
          rejection_note?: string | null
          review_reason?: string | null
          status?: string
          submitted_at?: string | null
          suspension_reason?: string | null
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      psp_events: {
        Row: {
          created_at: string
          event_key: string
          id: string
          payload: Json
          received_at: string
          region: string
          source: string
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: string
          payload: Json
          received_at?: string
          region: string
          source: string
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: string
          payload?: Json
          received_at?: string
          region?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "psp_events_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      quality_flags: {
        Row: {
          figure: Json
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          note: string | null
          outcome: string | null
          provider_id: string
          raised_at: string
          region: string
          source_id: string | null
        }
        Insert: {
          figure: Json
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          note?: string | null
          outcome?: string | null
          provider_id: string
          raised_at?: string
          region: string
          source_id?: string | null
        }
        Update: {
          figure?: Json
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          outcome?: string | null
          provider_id?: string
          raised_at?: string
          region?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_flags_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_flags_provider_region_fk"
            columns: ["provider_id", "region"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "quality_flags_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      questions: {
        Row: {
          active: boolean
          affects_pricing: boolean
          category_id: string
          created_at: string
          display_order: number
          help_text: Json | null
          id: string
          key: string
          label: Json
          options: Json | null
          region: string
          required: boolean
          service_id: string | null
          type: string
          validation: Json | null
        }
        Insert: {
          active?: boolean
          affects_pricing?: boolean
          category_id: string
          created_at?: string
          display_order?: number
          help_text?: Json | null
          id?: string
          key: string
          label: Json
          options?: Json | null
          region: string
          required?: boolean
          service_id?: string | null
          type: string
          validation?: Json | null
        }
        Update: {
          active?: boolean
          affects_pricing?: boolean
          category_id?: string
          created_at?: string
          display_order?: number
          help_text?: Json | null
          id?: string
          key?: string
          label?: Json
          options?: Json | null
          region?: string
          required?: boolean
          service_id?: string | null
          type?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_category_fk"
            columns: ["category_id", "region"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "questions_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "questions_service_fk"
            columns: ["service_id", "category_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "category_id"]
          },
        ]
      }
      quote_counters: {
        Row: {
          count: number
          region: string
          user_id: string
          window_start: string
        }
        Insert: {
          count: number
          region: string
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          region?: string
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_counters_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "quote_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_hides: {
        Row: {
          created_at: string
          hidden_by: string
          note: string
          rating_id: string
          reason: string
          region: string
        }
        Insert: {
          created_at?: string
          hidden_by: string
          note: string
          rating_id: string
          reason: string
          region: string
        }
        Update: {
          created_at?: string
          hidden_by?: string
          note?: string
          rating_id?: string
          reason?: string
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "rating_hides_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_hides_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: true
            referencedRelation: "ratings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_hides_rating_region_fk"
            columns: ["rating_id", "region"]
            isOneToOne: false
            referencedRelation: "ratings"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "rating_hides_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      ratings: {
        Row: {
          application_id: string
          created_at: string
          customer_id: string
          id: string
          professionalism: number
          provider_id: string
          punctuality: number
          quality: number
          region: string
          request_id: string
          value: number
        }
        Insert: {
          application_id: string
          created_at?: string
          customer_id: string
          id?: string
          professionalism: number
          provider_id: string
          punctuality: number
          quality: number
          region: string
          request_id: string
          value: number
        }
        Update: {
          application_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          professionalism?: number
          provider_id?: string
          punctuality?: number
          quality?: number
          region?: string
          request_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_application_request_fk"
            columns: ["application_id", "request_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "ratings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ratings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_request_region_customer_fk"
            columns: ["request_id", "region", "customer_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region", "customer_id"]
          },
        ]
      }
      regions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          currency: string
          default_locale: string
          dial_code: string
          psp_provider: string
          timezone: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          currency: string
          default_locale: string
          dial_code: string
          psp_provider: string
          timezone: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          currency?: string
          default_locale?: string
          dial_code?: string
          psp_provider?: string
          timezone?: string
        }
        Relationships: []
      }
      report_photos: {
        Row: {
          created_at: string
          id: string
          object_id: string
          object_path: string
          region: string
          report_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          object_id: string
          object_path: string
          region: string
          report_id: string
        }
        Update: {
          created_at?: string
          id?: string
          object_id?: string
          object_path?: string
          region?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_photos_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "report_photos_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "problem_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      request_addresses: {
        Row: {
          created_at: string
          customer_id: string
          line: string
          region: string
          request_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          line: string
          region: string
          request_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          line?: string
          region?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_addresses_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "request_addresses_request_fk"
            columns: ["request_id", "region", "customer_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region", "customer_id"]
          },
        ]
      }
      requests: {
        Row: {
          actual_completed_at: string | null
          actual_started_at: string | null
          addon_ids: string[]
          answers: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_due: number
          client_key: string
          closed_at: string | null
          closed_by: string | null
          commission_amount: number
          confirm_deadline: string | null
          confirm_extended_at: string | null
          created_at: string
          currency: string
          customer_id: string
          failed_picks: number
          fee_deadline: string | null
          fixed_price: number
          id: string
          notes: string | null
          payment_deadline: string | null
          pricing_snapshot: Json
          questions_snapshot: Json
          region: string
          scheduled_end_at: string
          scheduled_start_at: string
          selected_application_id: string | null
          selected_at: string | null
          service_id: string
          status: string
          zone_id: string
        }
        Insert: {
          actual_completed_at?: string | null
          actual_started_at?: string | null
          addon_ids?: string[]
          answers: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_due: number
          client_key: string
          closed_at?: string | null
          closed_by?: string | null
          commission_amount: number
          confirm_deadline?: string | null
          confirm_extended_at?: string | null
          created_at?: string
          currency: string
          customer_id: string
          failed_picks?: number
          fee_deadline?: string | null
          fixed_price: number
          id?: string
          notes?: string | null
          payment_deadline?: string | null
          pricing_snapshot: Json
          questions_snapshot: Json
          region: string
          scheduled_end_at: string
          scheduled_start_at: string
          selected_application_id?: string | null
          selected_at?: string | null
          service_id: string
          status?: string
          zone_id: string
        }
        Update: {
          actual_completed_at?: string | null
          actual_started_at?: string | null
          addon_ids?: string[]
          answers?: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_due?: number
          client_key?: string
          closed_at?: string | null
          closed_by?: string | null
          commission_amount?: number
          confirm_deadline?: string | null
          confirm_extended_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          failed_picks?: number
          fee_deadline?: string | null
          fixed_price?: number
          id?: string
          notes?: string | null
          payment_deadline?: string | null
          pricing_snapshot?: Json
          questions_snapshot?: Json
          region?: string
          scheduled_end_at?: string
          scheduled_start_at?: string
          selected_application_id?: string | null
          selected_at?: string | null
          service_id?: string
          status?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "requests_selected_application_fk"
            columns: ["selected_application_id", "id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "requests_service_fk"
            columns: ["service_id", "region"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "requests_zone_fk"
            columns: ["zone_id", "region"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      service_agreements: {
        Row: {
          application_id: string
          byte_size: number | null
          content: Json
          created_at: string
          customer_opened_at: string | null
          failed_at: string | null
          id: string
          number: string
          provider_opened_at: string | null
          region: string
          rendered_at: string | null
          request_id: string
          sha256: string | null
          storage_path: string | null
          template_id: string
        }
        Insert: {
          application_id: string
          byte_size?: number | null
          content: Json
          created_at?: string
          customer_opened_at?: string | null
          failed_at?: string | null
          id?: string
          number: string
          provider_opened_at?: string | null
          region: string
          rendered_at?: string | null
          request_id: string
          sha256?: string | null
          storage_path?: string | null
          template_id: string
        }
        Update: {
          application_id?: string
          byte_size?: number | null
          content?: Json
          created_at?: string
          customer_opened_at?: string | null
          failed_at?: string | null
          id?: string
          number?: string
          provider_opened_at?: string | null
          region?: string
          rendered_at?: string | null
          request_id?: string
          sha256?: string | null
          storage_path?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_agreements_application_fk"
            columns: ["application_id", "request_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "service_agreements_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "service_agreements_request_fk"
            columns: ["request_id", "region"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "service_agreements_template_fk"
            columns: ["template_id", "region"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id", "region"]
          },
        ]
      }
      service_categories: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          id: string
          name: Json
          region: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          name: Json
          region: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          name?: Json
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          display_order: number
          hours_max: number
          hours_min: number
          id: string
          name: Json
          note: Json | null
          region: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          display_order?: number
          hours_max: number
          hours_min: number
          id?: string
          name: Json
          note?: Json | null
          region: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          display_order?: number
          hours_max?: number
          hours_min?: number
          id?: string
          name?: Json
          note?: Json | null
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_fk"
            columns: ["category_id", "region"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id", "region"]
          },
          {
            foreignKeyName: "services_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      terms_acceptances: {
        Row: {
          accepted_at: string
          id: string
          locale: string
          region: string
          terms_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          locale: string
          region: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          locale?: string
          region?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptances_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "terms_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      test_phones: {
        Row: {
          created_at: string
          note: string | null
          phone: string
          region: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          phone: string
          region?: string
        }
        Update: {
          created_at?: string
          note?: string | null
          phone?: string
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_phones_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
      user_warnings: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string
          id: string
          reason: string
          region: string
          report_id: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          reason: string
          region: string
          report_id?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          region?: string
          report_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_warnings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_warnings_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "user_warnings_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "problem_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_warnings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          id: string
          multiplier: number
          name: Json
          region: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          multiplier?: number
          name: Json
          region: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          id?: string
          multiplier?: number
          name?: Json
          region?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_region_fkey"
            columns: ["region"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_checkout: { Args: { p_attempt_id: string }; Returns: Json }
      accept_commission: {
        Args: { p_attempt: string; p_fee: string }
        Returns: boolean
      }
      accept_provider_docs_consent: {
        Args: { p_locale: string }
        Returns: Json
      }
      accept_provider_fee: {
        Args: { p_attempt: string; p_fee: string }
        Returns: boolean
      }
      acknowledge_warning: { Args: { p_warning_id: string }; Returns: Json }
      active_agreement_template: { Args: { p_region: string }; Returns: string }
      add_report_photo: {
        Args: { p_object_path: string; p_report_id: string }
        Returns: Json
      }
      admin_agreement_link: { Args: { p_id: string }; Returns: Json }
      admin_agreements: {
        Args: { p_after?: string; p_query?: string }
        Returns: Json
      }
      admin_cancel_request: {
        Args: {
          p_attributed_to: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_clear_flag: {
        Args: { p_flag_id: string; p_note: string }
        Returns: Json
      }
      admin_end_probation: {
        Args: { p_note: string; p_provider_id: string }
        Returns: Json
      }
      admin_extend_deadline: {
        Args: {
          p_hours: number
          p_reason: string
          p_request_id: string
          p_which: string
        }
        Returns: Json
      }
      admin_flags: { Args: { p_page: number }; Returns: Json }
      admin_handle_quality_flag: {
        Args: { p_flag_id: string; p_note: string; p_outcome: string }
        Returns: Json
      }
      admin_hide_rating: {
        Args: { p_note: string; p_rating_id: string; p_reason: string }
        Returns: Json
      }
      admin_mark_refund_done: {
        Args: { p_note: string; p_refund_id: string }
        Returns: Json
      }
      admin_may_read: {
        Args: { p_name: string; p_object_id: string }
        Returns: boolean
      }
      admin_probation: { Args: { p_page: number }; Returns: Json }
      admin_provider_quality: { Args: { p_provider_id: string }; Returns: Json }
      admin_provider_ratings: {
        Args: { p_page: number; p_provider_id: string }
        Returns: Json
      }
      admin_quality_flags: { Args: { p_page: number }; Returns: Json }
      admin_quality_funnel: { Args: never; Returns: Json }
      admin_refund_fee: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: Json
      }
      admin_report_detail: { Args: { p_report_id: string }; Returns: Json }
      admin_reports: { Args: { p_page: number; p_tab: string }; Returns: Json }
      admin_reports_open_count: { Args: never; Returns: number }
      admin_request_address: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      admin_request_detail: { Args: { p_request_id: string }; Returns: Json }
      admin_requests: {
        Args: {
          p_from: string
          p_has_flag: boolean
          p_page: number
          p_region: string
          p_status: string
          p_to: string
        }
        Returns: Json
      }
      admin_rerender_agreement: { Args: { p_id: string }; Returns: Json }
      admin_revenue: {
        Args: { p_from: string; p_grain: string; p_to: string }
        Returns: Json
      }
      after_commission_paid: { Args: { p_fee: string }; Returns: undefined }
      after_provider_fee_paid: { Args: { p_fee: string }; Returns: undefined }
      after_reopen: { Args: { p_request_id: string }; Returns: string }
      agreement_body_valid: { Args: { p_body: Json }; Returns: boolean }
      agreement_field_names: { Args: never; Returns: string[] }
      agreement_file: { Args: { p_id: string }; Returns: Json }
      agreement_gaps: { Args: never; Returns: Json }
      agreement_read_allowed: { Args: { p_name: string }; Returns: boolean }
      agreement_render_context: { Args: { p_id: string }; Returns: Json }
      agreement_side: {
        Args: {
          p_s: Database["public"]["Tables"]["service_agreements"]["Row"]
          p_uid: string
        }
        Returns: string
      }
      agreement_template: { Args: { p_version?: string }; Returns: Json }
      agreement_text_valid: { Args: { p_text: string }; Returns: boolean }
      agreement_tr_text: { Args: { p_name: Json }; Returns: string }
      agreement_visible: { Args: { p_id: string }; Returns: boolean }
      answers_joined_text: {
        Args: { p_answers: Json; p_snapshot: Json }
        Returns: string
      }
      application_questions_digest: { Args: { p_list: Json }; Returns: string }
      application_questions_list: {
        Args: { p_category_id: string; p_region: string }
        Returns: Json
      }
      application_questions_version: {
        Args: { p_category_id: string; p_region: string }
        Returns: string
      }
      apply_fee_paid: {
        Args: {
          p_amount: number
          p_attempt_id: string
          p_currency: string
          p_fee_payment_id: string
          p_psp_fee: number
          p_psp_payment_id: string
        }
        Returns: Json
      }
      apply_fee_refunded: {
        Args: { p_fee_refund_id: string; p_psp_refund_id: string }
        Returns: Json
      }
      apply_needs_email: { Args: { p_region: string }; Returns: boolean }
      apply_settings: { Args: { p_region: string }; Returns: Json }
      apply_to_request: {
        Args: {
          p_answers?: Json
          p_message?: string
          p_questions_version?: string
          p_request_id: string
        }
        Returns: Json
      }
      approved_applied_count: {
        Args: { p_request_id: string }
        Returns: number
      }
      attempt_open: {
        Args: { p_fee_payment_id: string; p_region: string }
        Returns: boolean
      }
      audit_notices: {
        Args: { p_audit_id: number }
        Returns: {
          o_deadline: string
          o_entity: string
          o_kind: string
          o_recipient: string
          o_request: string
          o_send_until: string
          o_topic: string
        }[]
      }
      auto_close_enabled: { Args: { p_region: string }; Returns: boolean }
      auto_close_jobs: { Args: never; Returns: number }
      blank_class: { Args: never; Returns: string }
      blank_marks: { Args: never; Returns: string }
      cancel_by_rule: {
        Args: {
          p_action: string
          p_actor: string
          p_by: string
          p_cancel_reason: string
          p_meta?: Json
          p_refund_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      cancel_preview: { Args: { p_request_id: string }; Returns: Json }
      cancel_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      cancel_rule: {
        Args: { p_actor: string; p_region: string; p_state: string }
        Returns: {
          actor: string
          allowed: boolean
          commission_outcome: string
          counts_against: string
          provider_fee_outcome: string
          region: string
          state: string
        }
        SetofOptions: {
          from: "*"
          to: "cancellation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_state: { Args: { p_request_id: string }; Returns: string }
      carried_commission: { Args: { p_request_id: string }; Returns: string }
      catalog_text_ok: {
        Args: { p_max: number; p_region: string; p_value: Json }
        Returns: boolean
      }
      catalog_trim: { Args: { p_text: string }; Returns: string }
      check_new_user: { Args: { event: Json }; Returns: Json }
      checkout_context: { Args: { p_attempt_id: string }; Returns: Json }
      checkout_limit: { Args: { p_region: string }; Returns: number }
      checkout_settings: { Args: { p_region: string }; Returns: Json }
      choose_provider: {
        Args: {
          p_agreement_version?: string
          p_application_id: string
          p_request_id: string
        }
        Returns: Json
      }
      choose_settings: { Args: { p_region: string }; Returns: number }
      claim_email_outbox: {
        Args: { p_limit: number; p_worker: string }
        Returns: Json
      }
      claim_outbox: {
        Args: { p_limit: number; p_worker: string }
        Returns: Json
      }
      clear_deadline_flags: {
        Args: { p_kinds: string[]; p_request_id: string }
        Returns: undefined
      }
      close_job: {
        Args: { p_action: string; p_by: string; p_request_id: string }
        Returns: undefined
      }
      commission_settled: { Args: { p_request_id: string }; Returns: string }
      commission_side_settled: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      complete_onboarding: {
        Args: {
          p_accept_terms: boolean
          p_full_name: string
          p_locale: string
          p_role: string
        }
        Returns: Json
      }
      confirm_email: { Args: { p_token: string }; Returns: Json }
      confirm_job: { Args: { p_request_id: string }; Returns: Json }
      confirm_settings: { Args: { p_region: string }; Returns: number }
      contact_normalise: { Args: { p_text: string }; Returns: string }
      contact_settings: { Args: { p_region: string }; Returns: number }
      contacts_visible: { Args: { p_request_id: string }; Returns: boolean }
      count_application: {
        Args: { p_limit: number; p_provider_id: string; p_region: string }
        Returns: number
      }
      count_quote: {
        Args: { p_region: string; p_user_id: string }
        Returns: number
      }
      create_request: {
        Args: {
          p_addon_ids: string[]
          p_address_line: string
          p_answers: Json
          p_client_key: string
          p_expected_commission: number
          p_expected_price: number
          p_notes: string
          p_service_id: string
          p_start_date: string
          p_start_hour: number
          p_zone_id: string
        }
        Returns: Json
      }
      customer_mark_done: { Args: { p_request_id: string }; Returns: Json }
      decide_provider: {
        Args: {
          p_code: string
          p_decision: string
          p_note: string
          p_provider_id: string
          p_seen_updated_at: string
        }
        Returns: Json
      }
      document_reminder_days: { Args: { p_region: string }; Returns: number }
      email_context: { Args: { p_outbox_id: string }; Returns: Json }
      email_settings: { Args: { p_region: string }; Returns: Json }
      emails_enabled: { Args: { p_region: string }; Returns: boolean }
      emails_housekeeping: { Args: never; Returns: number }
      end_pick: {
        Args: {
          p_application_status: string
          p_failed: boolean
          p_request_id: string
        }
        Returns: string
      }
      enqueue_outbox: {
        Args: {
          p_key: string
          p_kind: string
          p_payload: Json
          p_region: string
        }
        Returns: string
      }
      expire_request: { Args: { p_request_id: string }; Returns: string }
      expire_windows: { Args: never; Returns: number }
      extension_in_band: {
        Args: { p_cap: string; p_new: string; p_old: string }
        Returns: boolean
      }
      fail_agreement_render: { Args: { p_id: string }; Returns: Json }
      fail_attempt: {
        Args: { p_attempt_id: string; p_reason: string }
        Returns: Json
      }
      fake_psp_get: { Args: { p_token: string }; Returns: Json }
      fake_psp_set: {
        Args: { p_outcome: Json; p_token: string }
        Returns: undefined
      }
      fake_psp_token: { Args: { p_key: string }; Returns: string }
      fee_amount: {
        Args: { p_price: number; p_settings: Json }
        Returns: number
      }
      fee_settings: {
        Args: { p_region: string; p_unit?: number }
        Returns: Json
      }
      finish_agreement_render: {
        Args: {
          p_byte_size: number
          p_id: string
          p_path: string
          p_sha256: string
        }
        Returns: Json
      }
      finish_email: {
        Args: {
          p_claim_token: string
          p_detail?: string
          p_id: string
          p_outcome: string
        }
        Returns: Json
      }
      finish_job: { Args: { p_request_id: string }; Returns: Json }
      finish_outbox: {
        Args: {
          p_claim_token: string
          p_error: string
          p_id: string
          p_ok: boolean
        }
        Returns: Json
      }
      grace_hours: {
        Args: { p_key: string; p_region: string }
        Returns: number
      }
      handle_report: {
        Args: {
          p_note: string
          p_outcome: string
          p_refund_payment_id?: string
          p_report_id: string
          p_warning_reason?: string
        }
        Returns: Json
      }
      has_contact_info: { Args: { p_text: string }; Returns: boolean }
      health_ping: { Args: never; Returns: boolean }
      insert_notice: {
        Args: {
          p_deadline: string
          p_entity: string
          p_key: string
          p_kind: string
          p_recipient: string
          p_region: string
          p_request: string
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      job_for_provider: {
        Args: { p_request_id: string }
        Returns: {
          answers: Json | null
          created_at: string
          fee_extended_at: string | null
          id: string
          message: string | null
          payment_extended_at: string | null
          provider_fee_amount: number | null
          provider_fee_kind: string | null
          provider_id: string
          questions_snapshot: Json | null
          region: string
          request_id: string
          status: string
          status_changed_at: string
          unlocked_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ledger_check: { Args: { p_region: string }; Returns: Json }
      lock_attempt: {
        Args: { p_attempt_id: string }
        Returns: {
          created_at: string
          failure_reason: string | null
          fee_payment_id: string
          finished_at: string | null
          id: string
          locale: string | null
          payer_ip: unknown
          psp_token: string | null
          region: string
          started_at: string
          status: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "checkout_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      log_document_view: {
        Args: { p_document_id: string; p_object_id: string }
        Returns: Json
      }
      log_report_photo_view: { Args: { p_photo_id: string }; Returns: Json }
      mark_all_notices_read: { Args: never; Returns: number }
      mark_checkout_failed: {
        Args: { p_attempt_id: string; p_reason: string }
        Returns: Json
      }
      mark_checkout_ready: {
        Args: { p_attempt_id: string; p_token: string; p_url: string }
        Returns: Json
      }
      mark_refund_failed: { Args: { p_fee_refund_id: string }; Returns: Json }
      message_digit_limit: { Args: never; Returns: number }
      message_has_contact_info: { Args: { p_text: string }; Returns: boolean }
      my_accepted_agreement: { Args: { p_request_id: string }; Returns: string }
      my_agreement: { Args: { p_request_id: string }; Returns: Json }
      my_checkout: { Args: { p_attempt_id: string }; Returns: Json }
      my_notice_count: { Args: never; Returns: number }
      my_notices: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          created_at: string
          deadline_at: string
          default_locale: string
          entity_id: string
          id: string
          kind: string
          read_at: string
          request_id: string
          service_name: Json
          timezone: string
        }[]
      }
      my_provider_quality: { Args: never; Returns: Json }
      my_provider_rating: { Args: never; Returns: Json }
      my_receipt: { Args: { p_receipt_id: string }; Returns: Json }
      my_report: { Args: { p_request_id: string }; Returns: Json }
      my_warning: { Args: never; Returns: Json }
      notices_enabled: { Args: { p_region: string }; Returns: boolean }
      notices_housekeeping: { Args: never; Returns: number }
      offer_answers: {
        Args: { p_answers: Json; p_snapshot: Json }
        Returns: Json
      }
      offer_card: {
        Args: {
          p_application: Database["public"]["Tables"]["applications"]["Row"]
          p_timezone: string
        }
        Returns: Json
      }
      offer_display_name: { Args: { p_name: string }; Returns: Json }
      open_fee: {
        Args: { p_kind: string; p_request_id: string }
        Returns: string
      }
      open_notice: {
        Args: { p_id: string }
        Returns: {
          entity_id: string
          kind: string
          request_id: string
        }[]
      }
      open_report: {
        Args: { p_reason: string; p_request_id: string; p_text: string }
        Returns: Json
      }
      open_service_agreement: { Args: { p_id: string }; Returns: Json }
      outbox_health: { Args: never; Returns: Json }
      pay_commission: {
        Args: {
          p_agreement_version?: string
          p_locale: string
          p_payer_ip: string
          p_request_id: string
        }
        Returns: Json
      }
      pay_provider_fee: {
        Args: {
          p_agreement_version?: string
          p_application_id: string
          p_locale: string
          p_payer_ip: string
        }
        Returns: Json
      }
      payments_enabled: { Args: { p_region: string }; Returns: boolean }
      phone_region: { Args: { p_phone: string }; Returns: string }
      post_journal: {
        Args: {
          p_currency: string
          p_fee_payment_id: string
          p_key: string
          p_kind: string
          p_legs: Json
          p_region: string
          p_response: Json
        }
        Returns: Json
      }
      preview_pricing_formula: {
        Args: {
          p_addon_ids: string[]
          p_answers: Json
          p_base: number
          p_modifiers: Json
          p_service_id: string
          p_zone_id: string
        }
        Returns: Json
      }
      pricing_answer_blank: { Args: { p_answer: Json }; Returns: boolean }
      pricing_answer_errors: {
        Args: { p_answers: Json; p_priced_only: boolean; p_questions: Json }
        Returns: Json
      }
      pricing_canonical: { Args: { p_modifiers: Json }; Returns: Json }
      pricing_compute: {
        Args: {
          p_addon_ids: string[]
          p_answers: Json
          p_base: number
          p_modifiers: Json
          p_preview: boolean
          p_region: string
          p_service_id: string
          p_zone_id: string
        }
        Returns: Json
      }
      pricing_evaluate: {
        Args: {
          p_addons_total: number
          p_answers: Json
          p_base: number
          p_max_multiple: number
          p_modifiers: Json
          p_multiplier: number
          p_rounding: number
        }
        Returns: Json
      }
      pricing_formula_errors: {
        Args: { p_base: number; p_modifiers: Json; p_service_id: string }
        Returns: Json
      }
      pricing_number_at_scale: {
        Args: { p_scale: number; p_value: Json }
        Returns: boolean
      }
      pricing_split: {
        Args: { p_price: number; p_region: string }
        Returns: Json
      }
      promote_to_admin: { Args: { p_phone: string }; Returns: undefined }
      provider_applications: {
        Args: { p_after_created_at: string; p_after_id: string }
        Returns: Json
      }
      provider_apply_cap: {
        Args: { p_provider_id: string; p_region: string }
        Returns: number
      }
      provider_back_to_review: {
        Args: {
          p_provider: Database["public"]["Tables"]["providers"]["Row"]
          p_reason: string
        }
        Returns: undefined
      }
      provider_caller: {
        Args: never
        Returns: {
          approved_at: string | null
          approved_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_type: string | null
          id: string
          legal_name: string | null
          region: string
          rejection_code: string | null
          rejection_note: string | null
          review_reason: string | null
          status: string
          submitted_at: string | null
          suspension_reason: string | null
          tax_number: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "providers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provider_can_apply: { Args: { p_provider_id: string }; Returns: boolean }
      provider_cancel_job: { Args: { p_request_id: string }; Returns: Json }
      provider_card_quality: { Args: { p_provider_id: string }; Returns: Json }
      provider_caused_cancel: {
        Args: { p_cancelled_by: string; p_request_id: string; p_status: string }
        Returns: boolean
      }
      provider_docs_consent_version: {
        Args: { p_region: string }
        Returns: string
      }
      provider_document_object_exists: {
        Args: {
          p_document: Database["public"]["Tables"]["provider_documents"]["Row"]
        }
        Returns: boolean
      }
      provider_ext_mime: { Args: { p_name: string }; Returns: string }
      provider_fee_for: {
        Args: { p_price: number; p_region: string }
        Returns: number
      }
      provider_fee_settled: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      provider_feed: {
        Args: {
          p_after_id: string
          p_after_outside: boolean
          p_after_start: string
          p_from: string
          p_service_ids: string[]
          p_to: string
          p_zone_ids: string[]
        }
        Returns: Json
      }
      provider_for_admin: {
        Args: { p_provider_id: string }
        Returns: {
          approved_at: string | null
          approved_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_type: string | null
          id: string
          legal_name: string | null
          region: string
          rejection_code: string | null
          rejection_note: string | null
          review_reason: string | null
          status: string
          submitted_at: string | null
          suspension_reason: string | null
          tax_number: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "providers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provider_has_docs_consent: {
        Args: { p_region: string; p_user: string }
        Returns: boolean
      }
      provider_history: { Args: { p_month: string }; Returns: Json }
      provider_home_counts: { Args: never; Returns: Json }
      provider_jobs: {
        Args: { p_after_changed_at: string; p_after_id: string; p_tab: string }
        Returns: Json
      }
      provider_jobs_done: { Args: { p_provider_id: string }; Returns: number }
      provider_live_jobs: { Args: { p_provider_id: string }; Returns: number }
      provider_may_store: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      provider_object_type: {
        Args: { p_bucket: string; p_name: string }
        Returns: string
      }
      provider_on_probation: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      provider_on_probation_with: {
        Args: { p_provider_id: string; p_set: Json }
        Returns: boolean
      }
      provider_outside_hours: {
        Args: {
          p_end_hour: number
          p_start: string
          p_start_hour: number
          p_timezone: string
          p_work_days: number[]
        }
        Returns: boolean
      }
      provider_quality: { Args: { p_provider_id: string }; Returns: Json }
      provider_quality_with: {
        Args: { p_provider_id: string; p_set: Json }
        Returns: Json
      }
      provider_rating_summary: {
        Args: { p_provider_id: string }
        Returns: Json
      }
      provider_reader: {
        Args: never
        Returns: {
          approved_at: string | null
          approved_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_type: string | null
          id: string
          legal_name: string | null
          region: string
          rejection_code: string | null
          rejection_note: string | null
          review_reason: string | null
          status: string
          submitted_at: string | null
          suspension_reason: string | null
          tax_number: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "providers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provider_request: { Args: { p_request_id: string }; Returns: Json }
      provider_required_types: { Args: { p_region: string }; Returns: string[] }
      provider_setup: { Args: never; Returns: Json }
      provider_setup_complete: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      provider_short_details: {
        Args: { p_request: Database["public"]["Tables"]["requests"]["Row"] }
        Returns: Json
      }
      provider_standing: { Args: { p_provider_id: string }; Returns: string }
      provider_store_allowed: {
        Args: { p_bucket: string; p_name: string; p_provider: string }
        Returns: boolean
      }
      provider_structured_answers: {
        Args: { p_answers: Json; p_questions: Json }
        Returns: Json
      }
      provider_type_bucket: { Args: { p_type: string }; Returns: string }
      psp_callback: { Args: { p_fields: Json; p_token: string }; Returns: Json }
      psp_payload_strip: {
        Args: { p_depth?: number; p_payload: Json }
        Returns: Json
      }
      psp_webhook: {
        Args: {
          p_event_key: string
          p_home_region: string
          p_payload: Json
          p_psp_payment_id: string
          p_token: string
        }
        Returns: Json
      }
      public_region_info: {
        Args: never
        Returns: {
          code: string
          dial_code: string
          support_whatsapp: string
        }[]
      }
      publish_pricing_formula: {
        Args: {
          p_base: number
          p_expected_version: number
          p_modifiers: Json
          p_service_id: string
        }
        Returns: Json
      }
      quality_crosses: {
        Args: { p_above: boolean; p_limit: number; p_min: number; p_rate: Json }
        Returns: boolean
      }
      quality_rate: { Args: { p_den: number; p_num: number }; Returns: Json }
      quality_settings: { Args: { p_region: string }; Returns: Json }
      quality_settings_or_null: { Args: { p_region: string }; Returns: Json }
      question_shape_ok: {
        Args: {
          p_options: Json
          p_region: string
          p_type: string
          p_validation: Json
        }
        Returns: boolean
      }
      queue_agreement: {
        Args: { p_application_id: string; p_request_id: string }
        Returns: string
      }
      queue_audit_email: { Args: { p_audit_id: number }; Returns: number }
      queue_audit_mail: {
        Args: {
          p_audit_id: number
          p_entity: string
          p_recipient: string
          p_region: string
          p_request: string
          p_send_until: string
          p_template: string
          p_topic?: string
        }
        Returns: number
      }
      queue_audit_notices: { Args: { p_audit_id: number }; Returns: number }
      queue_document_reminders: { Args: never; Returns: number }
      queue_email: {
        Args: {
          p_entity: string
          p_key: string
          p_recipient: string
          p_region: string
          p_request: string
          p_send_until: string
          p_template: string
          p_token?: string
          p_topic?: string
        }
        Returns: string
      }
      queue_fee_refund: {
        Args: { p_by: string; p_fee_id: string; p_reason: string }
        Returns: string
      }
      queue_offer_email: { Args: { p_application_id: string }; Returns: number }
      queue_offer_notice: {
        Args: { p_application_id: string }
        Returns: number
      }
      queue_reminders: { Args: never; Returns: number }
      quote_price: {
        Args: {
          p_addon_ids: string[]
          p_answers: Json
          p_service_id: string
          p_zone_id: string
        }
        Returns: Json
      }
      quote_request: {
        Args: {
          p_addon_ids: string[]
          p_answers: Json
          p_service_id: string
          p_zone_id: string
        }
        Returns: Json
      }
      raise_deadline_flags: { Args: never; Returns: number }
      raise_quality_flags: { Args: never; Returns: number }
      rate_provider: {
        Args: {
          p_professionalism: number
          p_punctuality: number
          p_quality: number
          p_request_id: string
          p_value: number
        }
        Returns: Json
      }
      rating_settings: { Args: { p_region: string }; Returns: Json }
      reconcile_daily_list: {
        Args: { p_day: string; p_limit: number; p_region: string }
        Returns: Json
      }
      reconcile_pending: { Args: never; Returns: Json }
      record_acceptance: {
        Args: {
          p_application_id: string
          p_request_id: string
          p_role: string
          p_template: string
          p_user: string
        }
        Returns: undefined
      }
      record_psp_event: {
        Args: {
          p_event_key: string
          p_payload: Json
          p_region: string
          p_source: string
        }
        Returns: Json
      }
      register_provider_document: {
        Args: { p_path: string; p_type: string }
        Returns: Json
      }
      reinstate_provider: { Args: { p_provider_id: string }; Returns: Json }
      relay_kick: { Args: { p_task: string }; Returns: number }
      report_party: {
        Args: {
          p_request: Database["public"]["Tables"]["requests"]["Row"]
          p_user: string
        }
        Returns: {
          against_id: string
          side: string
        }[]
      }
      report_photo_allowed: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      report_photo_name_ok: {
        Args: {
          p_name: string
          p_report: Database["public"]["Tables"]["problem_reports"]["Row"]
        }
        Returns: boolean
      }
      report_photo_store_allowed: {
        Args: { p_name: string; p_user: string }
        Returns: boolean
      }
      report_settings: { Args: { p_region: string }; Returns: Json }
      report_window_open: {
        Args: {
          p_request: Database["public"]["Tables"]["requests"]["Row"]
          p_window_days: number
        }
        Returns: boolean
      }
      request_catalog: { Args: never; Returns: Json }
      request_close_info: { Args: { p_request_id: string }; Returns: Json }
      request_contacts: { Args: { p_request_id: string }; Returns: Json }
      request_email_confirmation: { Args: never; Returns: Json }
      request_offers: { Args: { p_request_id: string }; Returns: Json }
      request_rating: { Args: { p_request_id: string }; Returns: Json }
      request_settings: { Args: { p_region: string }; Returns: Json }
      reselection_limit: { Args: { p_region: string }; Returns: number }
      review_provider_documents: {
        Args: {
          p_code: string
          p_ids: string[]
          p_note: string
          p_object_ids: string[]
          p_provider_id: string
          p_valid_until: string
          p_verdict: string
        }
        Returns: Json
      }
      save_provider_profile: {
        Args: {
          p_bio: string
          p_entity_type: string
          p_languages: string[]
          p_legal_name: string
          p_tax_number: string
          p_years: number
        }
        Returns: Json
      }
      save_provider_setup: {
        Args: {
          p_end_hour: number
          p_service_ids: string[]
          p_start_hour: number
          p_work_days: number[]
          p_zone_ids: string[]
        }
        Returns: Json
      }
      start_checkout: {
        Args: {
          p_fee_payment_id: string
          p_locale: string
          p_payer_ip: unknown
        }
        Returns: string
      }
      start_day_reached: { Args: { p_request_id: string }; Returns: boolean }
      start_email_confirmation: {
        Args: { p_profile_id: string }
        Returns: string
      }
      start_job: { Args: { p_request_id: string }; Returns: Json }
      submit_provider_file: { Args: never; Returns: Json }
      suspend_provider: {
        Args: { p_provider_id: string; p_reason: string }
        Returns: Json
      }
      unlock_settings: { Args: { p_region: string }; Returns: Json }
      withdraw_application: {
        Args: { p_application_id: string }
        Returns: Json
      }
      work_days_ok: { Args: { p_days: number[] }; Returns: boolean }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

