// landing_demo_content.value can hold any JSON-serializable shape (a plain
// string, an array, or an object, depending on the content key) -- unlike
// every other jsonb column in this app (annotation_json, cover_transform,
// etc, all always objects, typed `object | null`), so it needs a real Json
// union instead of that narrower convention.
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// "designer" is a legacy value kept for existing rows -- new invites use
// "editor" instead (Settings > Team & Permissions' 5-role set).
export type ProjectRole = "owner" | "admin" | "designer" | "editor" | "viewer" | "client";
export type Platform = "instagram" | "tiktok" | "pinterest" | "youtube";
// Matches the page-level nav (nav-tabs.tsx) -- what Team & Permissions'
// "Custom Permissions" checklist grants access to, per member.
export type ProjectPermission = "overview" | "grid" | "stories" | "calendar" | "brief" | "settings";
export type PostType = "post" | "reel" | "carousel";
export type PostStatus = "draft" | "scheduled" | "published" | "in_review";
export type StoryStatus = "draft" | "scheduled" | "published";
// Independent of PostStatus/StoryStatus above -- see the review_status
// column comment in schema.sql. Client Review Mode's approve/request-changes.
export type ReviewStatus = "pending" | "approved" | "changes_requested";
export type DesignTaskStatus = "open" | "in_progress" | "done";
export type MediaType = "image" | "video";
export type TaskSourceType = "manual" | "post" | "story";
export type TaskStatus = "todo" | "in_progress" | "done";
export type BriefTaskType = "story" | "newsletter";
export type BriefItemSection = "references" | "images" | "products";
export type AssetProvider = "google_drive" | "dropbox" | "box" | "onedrive" | "collect" | "other";
export type AssetType =
  | "product_photography"
  | "campaign"
  | "lifestyle"
  | "packaging"
  | "ugc"
  | "moodboard"
  | "videos"
  | "references"
  | "other";
// Always "not_configured" today -- no provider (Drive/Dropbox/etc) API
// integration exists yet to actually index a folder's contents. Kept as a
// real enum so a future integration can flip a row through these states
// without a schema change.
export type AssetCollectionAiStatus = "not_configured" | "indexing" | "analyzed" | "error";
export type BriefItemKind = "link" | "image";
export type BriefFrameSection = "frames" | "text";
export type BrandMoodboardCategory =
  | "logo"
  | "font"
  | "color"
  | "guideline"
  | "campaign"
  | "reference"
  | "texture"
  | "illustration"
  | "marketing"
  | "other";
export type GeneratedDesignPostType = "post" | "story" | "reel_cover" | "newsletter";
export type AiInsights = {
  brand_health_pct: number;
  today_label: string;
  next_gap_label: string;
  tone_label: string;
  content_mix_pct: number;
  content_mix_label: string;
  cta_usage_pct: number;
  cta_usage_label: string;
  notices: string[];
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          avatar_url: string | null;
          email: string | null;
          is_admin: boolean;
          created_at: string;
        };
        Insert: { id: string; name: string; avatar_url?: string | null; email?: string | null; is_admin?: boolean };
        Update: { name?: string; avatar_url?: string | null; email?: string | null; is_admin?: boolean };
        Relationships: [];
      };
      landing_demo_content: {
        Row: { key: string; value: Json; updated_at: string };
        Insert: { key: string; value: Json; updated_at?: string };
        Update: { value?: Json; updated_at?: string };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          name: string;
          brand_notes: string;
          platform: Platform;
          ig_username: string;
          ig_display_name: string;
          ig_bio: string;
          ig_posts_count: number;
          ig_followers_count: number;
          ig_following_count: number;
          ig_website_link: string;
          ig_handle: string;
          instagram_url: string;
          tiktok_url: string;
          content_pillars: string;
          industry: string;
          posts_per_week: number;
          stories_per_week: number;
          reels_per_week: number;
          newsletter_per_week: number;
          profile_photo_path: string | null;
          logo_storage_path: string | null;
          brand_image_storage_path: string | null;
          show_scheduled_dates: boolean;
          archived: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: {
          name: string;
          brand_notes?: string;
          platform?: Platform;
          ig_username?: string;
          ig_display_name?: string;
          ig_bio?: string;
          ig_posts_count?: number;
          ig_followers_count?: number;
          ig_following_count?: number;
          ig_website_link?: string;
          ig_handle?: string;
          instagram_url?: string;
          tiktok_url?: string;
          content_pillars?: string;
          industry?: string;
          posts_per_week?: number;
          stories_per_week?: number;
          reels_per_week?: number;
          newsletter_per_week?: number;
          profile_photo_path?: string | null;
          logo_storage_path?: string | null;
          brand_image_storage_path?: string | null;
          show_scheduled_dates?: boolean;
          archived?: boolean;
          created_by: string;
        };
        Update: {
          name?: string;
          brand_notes?: string;
          platform?: Platform;
          ig_username?: string;
          ig_display_name?: string;
          ig_bio?: string;
          ig_posts_count?: number;
          ig_followers_count?: number;
          ig_following_count?: number;
          ig_website_link?: string;
          ig_handle?: string;
          instagram_url?: string;
          tiktok_url?: string;
          content_pillars?: string;
          industry?: string;
          posts_per_week?: number;
          stories_per_week?: number;
          reels_per_week?: number;
          newsletter_per_week?: number;
          profile_photo_path?: string | null;
          logo_storage_path?: string | null;
          brand_image_storage_path?: string | null;
          show_scheduled_dates?: boolean;
          archived?: boolean;
        };
        Relationships: [];
      };
      project_sections: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          body: string;
          position: number;
          created_at: string;
        };
        Insert: {
          project_id: string;
          title?: string;
          body?: string;
          position?: number;
        };
        Update: { title?: string; body?: string; position?: number };
        Relationships: [];
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: ProjectRole;
          custom_permissions: string[] | null;
          notification_prefs: Record<string, boolean>;
          created_at: string;
        };
        Insert: {
          project_id: string;
          user_id: string;
          role?: ProjectRole;
          custom_permissions?: string[] | null;
          notification_prefs?: Record<string, boolean>;
        };
        Update: {
          role?: ProjectRole;
          custom_permissions?: string[] | null;
          notification_prefs?: Record<string, boolean>;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      media_assets: {
        Row: {
          id: string;
          project_id: string;
          storage_path: string;
          media_type: MediaType;
          uploaded_by: string;
          preview_storage_path: string | null;
          annotation_json: object | null;
          poster_storage_path: string | null;
          folder_id: string | null;
          generated_by_ai: boolean;
          created_at: string;
        };
        Insert: {
          project_id: string;
          storage_path: string;
          media_type?: MediaType;
          uploaded_by: string;
          poster_storage_path?: string | null;
          folder_id?: string | null;
          annotation_json?: object | null;
          generated_by_ai?: boolean;
        };
        Update: {
          storage_path?: string;
          media_type?: MediaType;
          preview_storage_path?: string | null;
          annotation_json?: object | null;
          poster_storage_path?: string | null;
          folder_id?: string | null;
          generated_by_ai?: boolean;
        };
        Relationships: [];
      };
      media_folders: {
        Row: { id: string; project_id: string; name: string; created_at: string };
        Insert: { project_id: string; name: string };
        Update: { name?: string };
        Relationships: [];
      };
      grid_rows: {
        Row: { id: string; project_id: string; position: number; created_at: string };
        Insert: { project_id: string; position: number };
        Update: { position?: number };
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          project_id: string;
          post_type: PostType;
          caption: string;
          notes: string;
          scheduled_date: string | null;
          scheduled_time: string | null;
          status: PostStatus;
          review_status: ReviewStatus;
          cover_transform: object | null;
          created_at: string;
        };
        Insert: {
          project_id: string;
          post_type?: PostType;
          caption?: string;
          notes?: string;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?: PostStatus;
          review_status?: ReviewStatus;
          cover_transform?: object | null;
        };
        Update: {
          post_type?: PostType;
          caption?: string;
          notes?: string;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?: PostStatus;
          review_status?: ReviewStatus;
          cover_transform?: object | null;
        };
        Relationships: [];
      };
      grid_slots: {
        Row: {
          id: string;
          row_id: string;
          position: number;
          post_id: string | null;
          cover_transform: object | null;
        };
        Insert: {
          row_id: string;
          position: number;
          post_id?: string | null;
          cover_transform?: object | null;
        };
        Update: { post_id?: string | null; cover_transform?: object | null };
        Relationships: [];
      };
      calendar_notes: {
        Row: { id: string; project_id: string; date: string; body: string; created_at: string };
        Insert: { project_id: string; date: string; body?: string };
        Update: { date?: string; body?: string };
        Relationships: [];
      };
      post_assets: {
        Row: { id: string; post_id: string; media_asset_id: string; position: number };
        Insert: { post_id: string; media_asset_id: string; position?: number };
        Update: { position?: number };
        Relationships: [
          {
            foreignKeyName: "post_assets_media_asset_id_fkey";
            columns: ["media_asset_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      post_links: {
        Row: { id: string; post_id: string; url: string; label: string };
        Insert: { post_id: string; url: string; label?: string };
        Update: { url?: string; label?: string };
        Relationships: [];
      };
      stories: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          scheduled_date: string | null;
          status: StoryStatus;
          review_status: ReviewStatus;
          notes: string;
          position: number;
          created_at: string;
        };
        Insert: {
          project_id: string;
          name?: string;
          scheduled_date?: string | null;
          status?: StoryStatus;
          review_status?: ReviewStatus;
          notes?: string;
          position?: number;
        };
        Update: {
          name?: string;
          scheduled_date?: string | null;
          status?: StoryStatus;
          review_status?: ReviewStatus;
          notes?: string;
          position?: number;
        };
        Relationships: [];
      };
      story_frames: {
        Row: {
          id: string;
          story_id: string;
          position: number;
          media_asset_id: string | null;
          link_url: string | null;
        };
        Insert: {
          story_id: string;
          position?: number;
          media_asset_id?: string | null;
          link_url?: string | null;
        };
        Update: { position?: number; media_asset_id?: string | null; link_url?: string | null };
        Relationships: [
          {
            foreignKeyName: "story_frames_media_asset_id_fkey";
            columns: ["media_asset_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      story_links: {
        Row: { id: string; story_id: string; url: string; label: string };
        Insert: { story_id: string; url: string; label?: string };
        Update: { url?: string; label?: string };
        Relationships: [];
      };
      design_task_templates: {
        Row: { id: string; project_id: string; title: string; body_json: object; created_at: string };
        Insert: { project_id: string; title: string; body_json?: object };
        Update: { title?: string; body_json?: object };
        Relationships: [];
      };
      design_tasks: {
        Row: {
          id: string;
          project_id: string;
          template_id: string | null;
          title: string;
          body_json: object;
          assigned_to: string | null;
          status: DesignTaskStatus;
          created_at: string;
        };
        Insert: {
          project_id: string;
          template_id?: string | null;
          title: string;
          body_json?: object;
          assigned_to?: string | null;
          status?: DesignTaskStatus;
        };
        Update: {
          title?: string;
          body_json?: object;
          assigned_to?: string | null;
          status?: DesignTaskStatus;
        };
        Relationships: [];
      };
      design_task_links: {
        Row: { id: string; design_task_id: string; url: string; label: string };
        Insert: { design_task_id: string; url: string; label?: string };
        Update: { url?: string; label?: string };
        Relationships: [];
      };
      design_task_assets: {
        Row: { id: string; design_task_id: string; media_asset_id: string };
        Insert: { design_task_id: string; media_asset_id: string };
        Update: { media_asset_id?: string };
        Relationships: [];
      };
      project_briefs: {
        Row: { project_id: string; body_json: object; updated_at: string };
        Insert: { project_id: string; body_json?: object };
        Update: { body_json?: object };
        Relationships: [];
      };
      brief_attachments: {
        Row: {
          id: string;
          project_id: string;
          original_storage_path: string;
          preview_storage_path: string | null;
          annotation_json: object | null;
          created_at: string;
        };
        Insert: {
          project_id: string;
          original_storage_path: string;
          preview_storage_path?: string | null;
          annotation_json?: object | null;
        };
        Update: {
          preview_storage_path?: string | null;
          annotation_json?: object | null;
        };
        Relationships: [];
      };
      brand_moodboard_items: {
        Row: {
          id: string;
          project_id: string;
          category: BrandMoodboardCategory;
          storage_path: string;
          label: string;
          notes: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          category: BrandMoodboardCategory;
          storage_path: string;
          label?: string;
          notes?: string;
        };
        Update: {
          category?: BrandMoodboardCategory;
          label?: string;
          notes?: string;
        };
        Relationships: [];
      };
      brief_tasks: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          content_types: BriefTaskType[];
          position: number;
          created_at: string;
        };
        Insert: {
          project_id: string;
          name?: string;
          content_types?: BriefTaskType[];
          position?: number;
        };
        Update: {
          name?: string;
          content_types?: BriefTaskType[];
          position?: number;
        };
        Relationships: [];
      };
      brief_task_items: {
        Row: {
          id: string;
          task_id: string;
          section: BriefItemSection;
          kind: BriefItemKind;
          url: string | null;
          label: string;
          notes: string;
          attachment_id: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          task_id: string;
          section: BriefItemSection;
          kind: BriefItemKind;
          url?: string | null;
          label?: string;
          notes?: string;
          attachment_id?: string | null;
          position?: number;
        };
        Update: {
          label?: string;
          notes?: string;
          position?: number;
        };
        Relationships: [];
      };
      brief_task_frames: {
        Row: {
          id: string;
          task_id: string;
          section: BriefFrameSection;
          label: string;
          body: string;
          position: number;
          created_at: string;
        };
        Insert: {
          task_id: string;
          section: BriefFrameSection;
          label: string;
          body?: string;
          position?: number;
        };
        Update: {
          label?: string;
          body?: string;
          position?: number;
        };
        Relationships: [];
      };
      brand_strategy: {
        Row: {
          project_id: string;
          brand_values: string;
          vision: string;
          voice: string;
          positioning: string;
          audience_notes: string;
          ai_summary: string;
          ai_brand_dna: string;
          ai_tone_of_voice: string;
          ai_communication_style: string;
          ai_content_pillars: string;
          ai_audience_snapshot: string;
          ai_visual_language: string;
          ai_avoid: string;
          ai_insights: AiInsights | null;
          ai_insights_updated_at: string | null;
          spectrum_serious_playful: number;
          spectrum_classic_futuristic: number;
          spectrum_premium_accessible: number;
          spectrum_editorial_commercial: number;
          spectrum_minimal_expressive: number;
          spectrum_luxury_casual: number;
          updated_at: string;
        };
        Insert: {
          project_id: string;
          brand_values?: string;
          vision?: string;
          voice?: string;
          positioning?: string;
          audience_notes?: string;
          ai_summary?: string;
          ai_brand_dna?: string;
          ai_tone_of_voice?: string;
          ai_communication_style?: string;
          ai_content_pillars?: string;
          ai_audience_snapshot?: string;
          ai_visual_language?: string;
          ai_avoid?: string;
          ai_insights?: AiInsights | null;
          ai_insights_updated_at?: string | null;
          spectrum_serious_playful?: number;
          spectrum_classic_futuristic?: number;
          spectrum_premium_accessible?: number;
          spectrum_editorial_commercial?: number;
          spectrum_minimal_expressive?: number;
          spectrum_luxury_casual?: number;
          updated_at?: string;
        };
        Update: {
          brand_values?: string;
          vision?: string;
          voice?: string;
          positioning?: string;
          audience_notes?: string;
          ai_summary?: string;
          ai_brand_dna?: string;
          ai_tone_of_voice?: string;
          ai_communication_style?: string;
          ai_content_pillars?: string;
          ai_audience_snapshot?: string;
          ai_visual_language?: string;
          ai_avoid?: string;
          ai_insights?: AiInsights | null;
          ai_insights_updated_at?: string | null;
          spectrum_serious_playful?: number;
          spectrum_classic_futuristic?: number;
          spectrum_premium_accessible?: number;
          spectrum_editorial_commercial?: number;
          spectrum_minimal_expressive?: number;
          spectrum_luxury_casual?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      brand_documents: {
        Row: {
          id: string;
          project_id: string;
          source_type: "file" | "link";
          storage_path: string | null;
          url: string | null;
          filename: string;
          uploaded_by: string;
          ai_analysis: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          source_type?: "file" | "link";
          storage_path?: string | null;
          url?: string | null;
          filename: string;
          uploaded_by: string;
          ai_analysis?: string;
        };
        Update: { ai_analysis?: string };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          title: string;
          notes: string;
          due_date: string | null;
          // Deprecated -- see `status`. Still a real column (never dropped)
          // but no code writes it anymore.
          completed: boolean;
          status: TaskStatus;
          assignee_id: string | null;
          source_type: TaskSourceType;
          source_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          project_id?: string | null;
          title: string;
          notes?: string;
          due_date?: string | null;
          status?: TaskStatus;
          assignee_id?: string | null;
          source_type?: TaskSourceType;
          source_id?: string | null;
        };
        Update: {
          title?: string;
          notes?: string;
          due_date?: string | null;
          status?: TaskStatus;
          assignee_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      task_comments: {
        Row: {
          id: string;
          task_id: string;
          author_id: string;
          text: string;
          created_at: string;
        };
        Insert: {
          task_id: string;
          author_id: string;
          text: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_comments: {
        Row: { id: string; post_id: string; author_id: string; text: string; created_at: string };
        Insert: { post_id: string; author_id: string; text: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      story_comments: {
        Row: { id: string; story_id: string; author_id: string; text: string; created_at: string };
        Insert: { story_id: string; author_id: string; text: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "story_comments_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: { id: string; project_id: string; actor_name: string; action: string; created_at: string };
        Insert: { project_id: string; actor_name: string; action: string };
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          event_key: string;
          title: string;
          description: string;
          icon: string;
          link: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          project_id?: string | null;
          event_key: string;
          title: string;
          description?: string;
          icon?: string;
          link?: string | null;
          read?: boolean;
        };
        Update: { read?: boolean };
        Relationships: [];
      };
      asset_collections: {
        Row: {
          id: string;
          project_id: string;
          folder_url: string;
          provider: AssetProvider;
          name: string;
          asset_type: AssetType;
          notes: string;
          cover_storage_path: string | null;
          ai_status: AssetCollectionAiStatus;
          last_synced_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          folder_url: string;
          provider?: AssetProvider;
          name: string;
          asset_type?: AssetType;
          notes?: string;
          cover_storage_path?: string | null;
          created_by: string;
        };
        Update: {
          folder_url?: string;
          provider?: AssetProvider;
          name?: string;
          asset_type?: AssetType;
          notes?: string;
          cover_storage_path?: string | null;
        };
        Relationships: [];
      };
      share_links: {
        Row: {
          id: string;
          project_id: string;
          token: string;
          title: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          token: string;
          title?: string;
          created_by: string;
        };
        Update: { title?: string };
        Relationships: [];
      };
      share_link_items: {
        Row: {
          id: string;
          share_link_id: string;
          post_id: string | null;
          story_id: string | null;
          position: number;
        };
        Insert: {
          share_link_id: string;
          post_id?: string | null;
          story_id?: string | null;
          position?: number;
        };
        Update: { position?: number };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_id_by_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
      reorder_grid_slots: {
        Args: { updates: { slotId: string; postId: string | null }[] };
        Returns: void;
      };
      get_shared_preview: {
        Args: { p_token: string };
        Returns: SharedPreviewPayload | null;
      };
      set_post_review_status: {
        Args: { p_post_id: string; p_status: ReviewStatus };
        Returns: void;
      };
      set_story_review_status: {
        Args: { p_story_id: string; p_status: ReviewStatus };
        Returns: void;
      };
      set_post_review_status_by_token: {
        Args: { p_token: string; p_post_id: string; p_status: ReviewStatus };
        Returns: void;
      };
      set_story_review_status_by_token: {
        Args: { p_token: string; p_story_id: string; p_status: ReviewStatus };
        Returns: void;
      };
      set_post_notes_by_token: {
        Args: { p_token: string; p_post_id: string; p_notes: string };
        Returns: void;
      };
      set_story_notes_by_token: {
        Args: { p_token: string; p_story_id: string; p_notes: string };
        Returns: void;
      };
      get_review_notify_context_by_token: {
        Args: { p_token: string; p_post_id: string | null; p_story_id: string | null };
        Returns: ReviewNotifyContext;
      };
    };
  };
}

export type SharedPreviewMediaItem = {
  mediaAssetId: string;
  storagePath: string;
  previewStoragePath: string | null;
  posterStoragePath: string | null;
  mediaType: MediaType;
};

export type SharedPreviewItem = {
  id: string;
  type: "post" | "story";
  postId: string | null;
  storyId: string | null;
  caption: string;
  notes: string;
  reviewStatus: ReviewStatus;
  media: SharedPreviewMediaItem[];
};

export type SharedPreviewMemberOption = { id: string; name: string };

export type SharedPreviewPayload = {
  title: string;
  projectName: string;
  items: SharedPreviewItem[];
  members: SharedPreviewMemberOption[];
};

export type ReviewNotifyContext = {
  projectId: string;
  title: string | null;
  members: SharedPreviewMemberOption[];
};
