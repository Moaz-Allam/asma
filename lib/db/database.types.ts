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
      applications: {
        Row: {
          created_at: string
          id: string
          message: string
          provider_id: string
          region: string
          request_id: string
          status: string
          status_changed_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          provider_id: string
          region: string
          request_id: string
          status?: string
          status_changed_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          provider_id?: string
          region?: string
          request_id?: string
          status?: string
          status_changed_at?: string
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
          addon_ids: string[]
          answers: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_due: number
          client_key: string
          commission_amount: number
          created_at: string
          currency: string
          customer_id: string
          fixed_price: number
          id: string
          notes: string | null
          pricing_snapshot: Json
          questions_snapshot: Json
          region: string
          scheduled_end_at: string
          scheduled_start_at: string
          service_id: string
          status: string
          zone_id: string
        }
        Insert: {
          addon_ids?: string[]
          answers: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_due: number
          client_key: string
          commission_amount: number
          created_at?: string
          currency: string
          customer_id: string
          fixed_price: number
          id?: string
          notes?: string | null
          pricing_snapshot: Json
          questions_snapshot: Json
          region: string
          scheduled_end_at: string
          scheduled_start_at: string
          service_id: string
          status?: string
          zone_id: string
        }
        Update: {
          addon_ids?: string[]
          answers?: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_due?: number
          client_key?: string
          commission_amount?: number
          created_at?: string
          currency?: string
          customer_id?: string
          fixed_price?: number
          id?: string
          notes?: string | null
          pricing_snapshot?: Json
          questions_snapshot?: Json
          region?: string
          scheduled_end_at?: string
          scheduled_start_at?: string
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
      accept_provider_docs_consent: {
        Args: { p_locale: string }
        Returns: Json
      }
      admin_may_read: {
        Args: { p_name: string; p_object_id: string }
        Returns: boolean
      }
      apply_settings: { Args: { p_region: string }; Returns: Json }
      apply_to_request: {
        Args: { p_message: string; p_request_id: string }
        Returns: Json
      }
      cancel_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      catalog_text_ok: {
        Args: { p_max: number; p_region: string; p_value: Json }
        Returns: boolean
      }
      catalog_trim: { Args: { p_text: string }; Returns: string }
      check_new_user: { Args: { event: Json }; Returns: Json }
      complete_onboarding: {
        Args: {
          p_accept_terms: boolean
          p_full_name: string
          p_locale: string
          p_role: string
        }
        Returns: Json
      }
      contact_normalise: { Args: { p_text: string }; Returns: string }
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
      has_contact_info: { Args: { p_text: string }; Returns: boolean }
      health_ping: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      log_document_view: {
        Args: { p_document_id: string; p_object_id: string }
        Returns: Json
      }
      phone_region: { Args: { p_phone: string }; Returns: string }
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
      provider_home_counts: { Args: never; Returns: Json }
      provider_may_store: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      provider_object_type: {
        Args: { p_bucket: string; p_name: string }
        Returns: string
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
      question_shape_ok: {
        Args: {
          p_options: Json
          p_region: string
          p_type: string
          p_validation: Json
        }
        Returns: boolean
      }
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
      register_provider_document: {
        Args: { p_path: string; p_type: string }
        Returns: Json
      }
      reinstate_provider: { Args: { p_provider_id: string }; Returns: Json }
      request_catalog: { Args: never; Returns: Json }
      request_settings: { Args: { p_region: string }; Returns: Json }
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
      submit_provider_file: { Args: never; Returns: Json }
      suspend_provider: {
        Args: { p_provider_id: string; p_reason: string }
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

