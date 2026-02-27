
export enum GarmentType {
  TOP = 'TOP',
  BOTTOM = 'BOTTOM'
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  level: string;
  provider: 'email' | 'google';
}

export interface Garment {
  id: string;
  type: GarmentType;
  image: string; // base64
  name: string;
}

export interface Comment {
  id: string;
  userName: string;
  content: string;
}

export interface Message {
  id: string;
  text: string;
  time: string;
  isMe: boolean;
  isEdited?: boolean;
  isRecalled?: boolean;
  reaction?: string;
  replyTo?: {
    userName: string;
    text: string;
  };
}

export interface ChatConversation {
  id: string;
  userName: string;
  userLevel: string;
  avatar: string;
  lastMessage: string;
  messages: Message[];
  isVirtual?: boolean;
  virtualPost?: {
    id: string;
    topImage: string;
    bottomImage: string;
    description: string;
    actionType: string;
  };
}

export type TransactionType = 'Bán' | 'Mua' | 'Thuê' | 'Chia sẻ';

export interface Post {
  id: string;
  user: {
    id: string;
    name: string;
    avatar: string;
    level: string;
  };
  time: string;
  description: string;
  topImage: string;
  bottomImage: string;
  location: string;
  tags: string[];
  transactionType?: TransactionType;
  stats: {
    likes: number;
    comments: number;
  };
  sampleComments: Comment[];
  isDraft?: boolean;
  isVirtual?: boolean;
}

export interface TravelLocation {
  name: string;
  address: string;
  description: string;
  specialtyFood: string;
  foodAddress: string;
}

export interface TravelPlan {
  luxury: TravelLocation[];
  local: TravelLocation[];
  transportation: {
    service: string;
    description: string;
    contactInfo: string;
  }[];
  culturalNote: string;
}

export interface GeminiOutfitResponse {
  outfits: {
    topIndex: number;
    bottomIndex: number;
    name: string;
    description: string;
    personality: string;
    locations: string[];
  }[];
}
