export type FrameType = 'aviator' | 'wayfarer' | 'rimless' | 'round' | 'cat';
export type FrameCat = 'sun' | 'med' | 'safe';
export type EyewearFrameMode = 'prescription' | 'sunglasses' | 'clip_on' | 'kids' | 'metal';
export type EyewearSubMode = 'optical' | 'sun';
export type FaceShape = 'oval' | 'round' | 'square';
export type FrameSize = 'Small' | 'Medium' | 'Large';
export type TryOnEngineMode = '2d' | '3d';
export type ShopStatus = 'trial' | 'active' | 'soon' | 'paused' | 'expired';
export type InquiryStatus = 'new' | 'confirmed' | 'alt';
export type OrderStage = 'review' | 'making' | 'ready' | 'done';
export type UserRole = 'admin' | 'merchant';

export type FrameMaterial = 'tr_plastic' | 'metal';

export interface LensRegionBox {
  cx: number; // normalized 0..1
  cy: number; // normalized 0..1
  w: number; // normalized 0..1
  h: number; // normalized 0..1
}

export interface ModelCalibration {
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  yawOffset?: number;
  pitchOffset?: number;
  frameWidthMm?: number;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  opticalDimensions?: string;
  material?: FrameMaterial;
  wrapCurvatureDeg?: number;
  thicknessMm?: number;
  bridgeCenterX?: number;
  bridgeCenterY?: number;
  tiltCorrectionDeg?: number;
  isSunglasses?: boolean;
  lensMaskUrl?: string;
  aspectRatio?: number;
  fitScale?: number;
  eyeLineOffset?: number;
  storeFrontUrl?: string;
  tryOnFrontUrl?: string;
  leftLensBox?: LensRegionBox;
  rightLensBox?: LensRegionBox;
}

export interface ProductImage {
  id: string;
  productId: string;
  angleYaw: number; // degrees (-90..+90) or special tag
  label: string;
  imageUrl: string; // processed transparent PNG/WebP data URL or Supabase Storage URL
  originalImageUrl?: string; // untouched original upload/capture preserved before processing
  lensMaskUrl?: string; // transparent PNG with opaque white lens region
  kind?: 'front_tryon' | 'gallery';
  sortOrder: number;
}

export interface ProductReview {
  id: string;
  productId: string;
  shopId: string;
  authorName: string;
  rating: number; // 1..5
  comment: string;
  createdAt: string;
}

export interface Product {
  id: string;
  shopId: string;
  code: string;
  name: string;
  description?: string;
  type: FrameType;
  cat: FrameCat;
  frameType?: EyewearFrameMode;
  subCategory?: EyewearSubMode;
  price: number;
  disc?: number; // discount_pct 0..90
  frame: string;
  lens: string;
  tryonMode?: TryOnEngineMode;
  processedImage?: string;
  storeFrontUrl?: string;
  tryOnFrontUrl?: string;
  imagePath?: string; // 1200px transparent Try-On PNG/WebP
  frontCatalogPath?: string; // 1200x900 #F8F9FA WebP studio shot
  sideImagePath?: string; // 1200x900 #F8F9FA 3/4 side shot
  clipOnImagePath?: string; // 1200px transparent Try-On PNG/WebP with magnetic sun clip-on
  clipOnFrontCatalogPath?: string; // 1200x900 #F8F9FA WebP studio shot with clip-on
  clipOnSideImagePath?: string; // 1200x900 #F8F9FA 3/4 side shot with clip-on
  aspectRatio?: number;
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  totalFrameWidthMm?: number;
  frameHexColor?: string;
  frameOpacity?: number;
  additionalImages?: string[];
  model3dUrl?: string;
  modelCalibration?: ModelCalibration;
  frameColors?: string[];
  availableColors?: string[];
  availableSizes?: FrameSize[];
  shapes: FaceShape[];
  images?: ProductImage[];
  glbUrl?: string;
  isPublished?: boolean;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface LensType {
  id: string;
  shopId?: string;
  name: string;
  en?: string;
  desc?: string;
  price: number;
  disc?: number;
  icon: string;
  on?: boolean;
}

export interface Brand {
  id: string;
  shopId?: string;
  name: string;
  en?: string;
  price: number;
  disc?: number;
  on?: boolean;
}

export interface ProtectionExtra {
  id: string;
  shopId?: string;
  name: string;
  price: number;
  disc?: number;
  on?: boolean;
}

export interface Shop {
  id: string;
  name: string;
  city: string;
  plan: string;
  days: number;
  status: ShopStatus;
  exp: string;
  slug: string;
  price: number;
  color: string;
  wa: string;
  logo: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  trialEndsAt?: string;
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
  rxn?: number;
  notes: string;
  pd: string;
  status: InquiryStatus;
  alt?: string;
  altFrom?: string;
  stage?: OrderStage;
  time: string;
  createdAt?: string;
  mine?: boolean;
  pay?: string;
}

export interface Plan {
  id: number;
  name: string;
  price: number;
  on: boolean;
  feats: string[];
}

export interface PaymentRecord {
  id: string;
  shopId?: string;
  shopName: string;
  amount: number;
  method: 'InstaPay' | 'Vodafone Cash';
  referenceNo?: string;
  status: 'ok' | 'wait' | 'late';
  date: string;
}

export interface AuditLog {
  id: string;
  actorRole: UserRole | 'system';
  shopId?: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface CartItem {
  key: string;
  productId?: string;
  name: string;
  desc: string;
  price: number;
  type: FrameType;
  frame: string;
  lens: string;
  size?: FrameSize;
}

export interface AuthSession {
  userId: string;
  email: string;
  role: UserRole;
  shopId?: string;
  mfaVerified?: boolean;
}
