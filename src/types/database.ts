export type ProjectRole = "owner" | "admin" | "designer";
export type Platform = "instagram" | "tiktok";
export type PostType = "post" | "reel" | "carousel";
export type PostStatus = "draft" | "scheduled" | "published" | "in_review";
export type StoryStatus = "draft" | "scheduled" | "published";
export type DesignTaskStatus = "open" | "in_progress" | "done";
export type MediaType = "image" | "video";
export type TaskSourceType = "manual" | "post" | "story";
export type BriefTaskType = "story" | "newsletter";
export type BriefItemSection = "references" | "images" | "products";
export type BriefItemKind = "link" | "image";
export type BriefFrameSection = "frames" | "text";
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
        Row: { id: string; name: string; avatar_url: string | null; created_at: string };
        Insert: { id: string; name: string; avatar_url?: string | null };
        Update: { name?: string; avatar_url?: string | null };
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
        Row: { project_id: string; user_id: string; role: ProjectRole; created_at: string };
        Insert: { project_id: string; user_id: string; role?: ProjectRole };
        Update: { role?: ProjectRole };
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
          created_at: string;
        };
        Insert: {
          project_id: string;
          storage_path: string;
          media_type?: MediaType;
          uploaded_by: string;
        };
        Update: { storage_path?: string; media_type?: MediaType };
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
          status: PostStatus;
          created_at: string;
        };
        Insert: {
          project_id: string;
          post_type?: PostType;
          caption?: string;
          notes?: string;
          scheduled_date?: string | null;
          status?: PostStatus;
        };
        Update: {
          post_type?: PostType;
          caption?: string;
          notes?: string;
          scheduled_date?: string | null;
          status?: PostStatus;
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
          notes: string;
          position: number;
          created_at: string;
        };
        Insert: {
          project_id: string;
          name?: string;
          scheduled_date?: string | null;
          status?: StoryStatus;
          notes?: string;
          position?: number;
        };
        Update: {
          name?: string;
          scheduled_date?: string | null;
          status?: StoryStatus;
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
          completed: boolean;
          source_type: TaskSourceType;
          source_id: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          project_id?: string | null;
          title: string;
          notes?: string;
          due_date?: string | null;
          completed?: boolean;
          source_type?: TaskSourceType;
          source_id?: string | null;
        };
        Update: {
          title?: string;
          notes?: string;
          due_date?: string | null;
          completed?: boolean;
        };
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
    };
  };
}
