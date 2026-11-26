export type UserRole = 'super_admin' | 'admin' | 'merchant';
export type FrameType = 'aviator' | 'wayfarer' | 'rimless' | 'round' | 'cat';
export type FrameCat = 'sun' | 'med' | 'safe';
export type EyewearFrameMode = 'prescription' | 'sunglasses' | 'clip_on' | 'kids' | 'metal';
export type EyewearSubMode = 'optical' | 'sun' | 'sunglasses' | 'kids_optical' | 'kids_sun';
export type FrameSize = 'Small' | 'Medium' | 'Large';
export type FaceShape = 'oval' | 'round' | 'square';
export type ShopStatus = 'trial' | 'active' | 'soon' | 'paused' | 'expired';
export type InquiryStatus = 'new' | 'confirmed' | 'alt';
export type InquiryStage = 'review' | 'making' | 'ready' | 'done';
export type OrderStage = InquiryStage;
export type BillingCycle = 'monthly' | 'annual';
export type PlanTierKey = 'basic' | 'pro' | 'premium';
export type TryOnMode = '2d' | '3d';
export type FrameMaterial = 'acetate' | 'metal' | 'rimless' | 'tr_plastic';
export type FrameShapeTag = 'round' | 'oval' | 'square' | 'cat_eye' | 'aviator';
export type FrameColorFamily = 'black' | 'brown_tortoise' | 'clear' | 'metal' | 'other';

export interface ProductImage {
  id: string;
  productId: string;
  angleYaw: number;
  label: string;
  imageUrl: string;
  originalImageUrl?: string;
  lensMaskUrl?: string;
  kind?: 'front_tryon' | 'gallery';
  sortOrder: number;
}

export interface LensRegionBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface ModelCalibration {
  presetUsed?: string;
  material?: FrameMaterial;
  detectedType?: FrameType;
  tiltCorrectionDeg?: number;
  bridgeCenterX?: number;
  bridgeCenterY?: number;
  leftLensBox?: LensRegionBox;
  rightLensBox?: LensRegionBox;
  lensMaskUrl?: string;
  storeFrontUrl?: string;
  tryOnFrontUrl?: string;
  isSunglasses?: boolean;
  fitScale?: number;
  eyeLineOffset?: number;
  aspectRatio?: number;
  frameWidthMm?: number;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  opticalDimensions?: string;
  model3dOffset?: { x: number; y: number; z: number };
  model3dScale?: number;
  wrapCurvatureDeg?: number;
  frameShapeTag?: FrameShapeTag;
  isPatterned?: boolean;
  colorFamily?: FrameColorFamily;
  modelCode?: string;
}

export interface FrameReview {
  id: string;
  productId: string;
  shopId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export type StoreThemeKey = 'royal_classic' | 'clinical_pure' | 'modern_dark' | 'emerald_elite';

export interface LandingPreviewFrame {
  id: string;
  name: string;
  type: FrameType;
  frameColor: string;
  lensColor: string;
  dimensions: string;
  imageUrl?: string;
  widthPx?: number;
}

export interface Shop {
  id: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  name: string;
  city: string;
  governorate?: string;
  address?: string;
  mapsUrl?: string;
  onboardingCompleted?: boolean;
  enableDeliveryService?: boolean;
  deliveryFee?: number;
  deliveryAreas?: string;
  isFeatured?: boolean;
  recall6mEnabled?: boolean;
  recall12mEnabled?: boolean;
  aiCreditsLimit?: number;
  aiCreditsUsed?: number;
  topupCredits?: number;
  isDemoAdminStore?: boolean;
  planTier?: PlanTierKey;
  billingCycle?: BillingCycle;
  plan: string;
  days: number;
  status: ShopStatus;
  exp: string;
  trialEndsAt?: string;
  slug: string;
  price: number;
  color: string;
  themeKey?: StoreThemeKey;
  aiLogoGenerations?: number;
  wa: string;
  logo: string;
  tagline?: string;
  bannerImageUrl?: string;
  videoUrl?: string;
  merchantLensConfigs?: MerchantLensBrandConfig[];
  groupColorsInStore?: boolean;
  showColorSwatchesToCustomer?: boolean;
}

export type LensTrack = 'single_vision' | 'custom_lab';
export type CustomLabDesign = 'progressive' | 'bifocal';
export type LensCategoryKey =
  | 'white_plastic'
  | 'anti_reflection'
  | 'blue_cut'
  | 'photochromic'
  | 'night_drive'
  | 'three_in_one';
export type LensIndex = '1.56' | '1.60' | '1.67' | '1.74';
export type PhotoVariant = 'none' | 'photo_grey' | 'photo_brown';
export type SponsorBadgeType = 'official_sponsor' | 'featured_partner' | 'none';

export interface LensMatrixPriceCell {
  enabled: boolean;
  recommendedPrice: number;
}

export interface OfficialLensBrand {
  id: string;
  track: LensTrack;
  nameAr: string;
  nameEn: string;
  origin?: string;
  priority: number;
  sponsorBadge: SponsorBadgeType;
  allowedVariancePct: number;
  estimatedDays?: number;
  supportsProgressive?: boolean;
  supportsBifocal?: boolean;
  isActive: boolean;
  prices: Record<string, LensMatrixPriceCell>;
}

export interface MerchantLensPriceCell {
  enabled: boolean;
  price: number;
}

export interface MerchantLensBrandConfig {
  shopId: string;
  brandId: string;
  track: LensTrack;
  isCustomBrand?: boolean;
  nameAr?: string;
  nameEn?: string;
  origin?: string;
  estimatedDays?: number;
  supportsProgressive?: boolean;
  supportsBifocal?: boolean;
  isEnabled: boolean;
  prices: Record<string, MerchantLensPriceCell>;
}

export interface Product {
  id: string;
  shopId: string;
  code: string;
  modelCode?: string;
  name: string;
  description?: string;
  type: FrameType;
  cat: FrameCat;
  frameType?: EyewearFrameMode;
  subCategory?: EyewearSubMode;
  price: number;
  salePrice?: number;
  disc: number;
  frame: string;
  lens: string;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  shapes: FaceShape[];
  glbUrl?: string;
  tryonMode?: TryOnMode;
  processedImage?: string;
  storeFrontUrl?: string;
  tryOnFrontUrl?: string;
  imagePath?: string;
  frontCatalogPath?: string;
  sideImagePath?: string;
  clipOnImagePath?: string;
  clipOnFrontCatalogPath?: string;
  clipOnSideImagePath?: string;
  aspectRatio?: number;
  frameHexColor?: string;
  frameOpacity?: number;
  keepLensBranding?: boolean;
  isCrystalFrame?: boolean;
  phash?: string;
  additionalImages?: string[];
  model3dUrl?: string;
  modelCalibration?: ModelCalibration;
  frameColors?: string[];
  availableColors?: string[];
  availableSizes?: FrameSize[];
  isPublished?: boolean;
  images?: ProductImage[];
  isDeleted?: boolean;
  frameShapeTag?: FrameShapeTag;
  isPatterned?: boolean;
  colorFamily?: FrameColorFamily;
  createdAt?: string;
}

export interface LensType {
  id: string;
  shopId: string;
  name: string;
  en: string;
  desc: string;
  price: number;
  disc: number;
  icon: string;
  on: boolean;
}

export interface Brand {
  id: string;
  shopId: string;
  name: string;
  en: string;
  price: number;
  disc: number;
  on: boolean;
}

export interface ProtectionExtra {
  id: string;
  shopId: string;
  name: string;
  price: number;
  disc: number;
  on: boolean;
}

export interface Inquiry {
  id: string;
  shopId: string;
  kind: 'rx' | 'order';
  cust: string;
  phone: string;
  frameName: string;
  type: FrameType;
  frame: string;
  lens: string;
  lensName: string;
  brandName: string;
  extrasTxt: string;
  fp: number;
  lensPrice: number;
  add: number;
  price: number;
  final?: number;
  img: string | null;
  rxn: number;
  notes: string;
  pd: string;
  status: InquiryStatus;
  alt?: string;
  altFrom?: string;
  stage: InquiryStage;
  time: string;
  method?: string;
  pay?: string;
  mine?: boolean;
  deliverySelected?: boolean;
  deliveryAddress?: string;
  governorate?: string;
  deliveryFee?: number;
}

export interface ProductReview {
  id: string;
  productId: string;
  shopId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface CrmCustomer {
  id: string;
  shopId: string;
  customerName: string;
  phone: string;
  productId?: string;
  productName: string;
  lensSummary?: string;
  pd?: string;
  orderDate: string;
  recall6mSentAt?: string;
  recall12mSentAt?: string;
  notes?: string;
}

export interface Plan {
  id: number;
  tierKey: PlanTierKey;
  name: string;
  price: number;
  maxProducts: number;
  monthlyAiCredits: number;
  turboUploadEnabled: boolean;
  cameraPdRulerEnabled: boolean;
  featuredBoostEnabled: boolean;
  on: boolean;
  feats: string[];
}

export interface SponsoredSupplier {
  id: string;
  name: string;
  specialty: string;
  city: string;
  wa: string;
  offerText: string;
  isActive: boolean;
}

export interface PlatformSettings {
  enablePrescriptionLenses: boolean;
  enableLensesSystem?: boolean;
  allowMerchantLensBrandingToggle: boolean;
  enableSponsoredSuppliers: boolean;
  enableStoresDirectory?: boolean;
  landingPreviewFrames?: LandingPreviewFrame[];
  officialLensBrands?: OfficialLensBrand[];
  plans: Plan[];
  annualDiscountMonths: number;
  trialDays: number;
  trialMaxProducts: number;
  trialAiCredits: number;
  topupPackFrames: number;
  topupPackPrice: number;
  sponsoredSuppliers: SponsoredSupplier[];
}

export interface PaymentRecord {
  id: string;
  shopId?: string;
  shopName: string;
  amount: number;
  method: string;
  referenceNo?: string;
  status: 'ok' | 'wait' | 'late';
  date: string;
}

export interface AuditLog {
  id: string;
  actorRole: string;
  shopId?: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  desc: string;
  price: number;
  type: FrameType;
  frame: string;
  lens: string;
  size?: FrameSize;
}

export interface VoteSession {
  id: string;
  productId: string;
  shopId: string;
  frameName: string;
  snapshotDataUrl: string;
  votes: { name: string; score: number; comment: string; at: string }[];
}

export interface SharedSessionData {
  uid?: string;
  email?: string;
  role: UserRole;
  shopId: string;
}

export interface UserSession extends SharedSessionData {
  uid: string;
  email: string;
}

export interface AuthSession {
  userId: string;
  email: string;
  role: UserRole;
  shopId?: string;
  mfaVerified?: boolean;
}

