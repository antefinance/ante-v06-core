export const DEPLOYMENT_ACTIONS = {
  DEPLOY: 'DEPLOY',
} as const;

export type DeploymentActionType = keyof typeof DEPLOYMENT_ACTIONS;

export const CHAIN_ACTIONS = {
  ADVANCE_BLOCKS: 'ADVANCE_BLOCKS',
  ADVANCE_TIME: 'ADVANCE_TIME',
} as const;

export type ChainActionType = keyof typeof CHAIN_ACTIONS;

export const SIGNED_ACTIONS = {
  STAKE: 'STAKE',
  UNSTAKE: 'UNSTAKE',
  REGISTER_CHALLENGE: 'REGISTER_CHALLENGE',
  CONFIRM_CHALLENGE: 'CONFIRM_CHALLENGE',
  UNSTAKE_CHALLENGE: 'UNSTAKE_CHALLENGE',
  CLAIM: 'CLAIM',
  CLAIM_REWARD: 'CLAIM_REWARD',
} as const;

export type SignedActionType = keyof typeof SIGNED_ACTIONS;

export const META_ACTIONS = {
  CHECK: 'CHECK',
} as const;

export type MetaActionType = keyof typeof META_ACTIONS;

export const ACTION_TYPES = {
  ...SIGNED_ACTIONS,
  ...DEPLOYMENT_ACTIONS,
  ...CHAIN_ACTIONS,
  ...META_ACTIONS,
} as const;

export type ActionType = keyof typeof ACTION_TYPES;

export interface Action<T> {
  type: ActionType;
  params: T;
}

export interface DeployActionParams {
  testAuthorRewardRate?: number;
  decayRate?: number;
  payoutRatio?: number;
}

export interface SignedActionParams {
  signer: string;
}

export interface StakeActionParams extends SignedActionParams {
  amount: string;
  commitTime?: string;
}

export interface RegisterChallengeActionParams extends SignedActionParams {
  amount: string;
}

export interface ConfirmChallengeActionParams extends SignedActionParams {}

export interface UnstakeActionParams extends SignedActionParams {
  amount: string;
  isChallenger?: string;
}

export interface UnstakeChallengeActionParams extends SignedActionParams {
  amount: string;
}

export interface ClaimActionParams extends SignedActionParams {}

export type AdvanceBlocksActionParams = {
  numBlocks?: string;
};

export type AdvanceTimeActionParams = {
  seconds?: string;
  days?: string;
};

export type CheckActionParams = Record<string, any>;

export const CHECK_ACTION_TYPE = {
  balance: 'balance',
  storedBalance: 'storedBalance',
} as const;

export type CheckActionType = keyof typeof CHECK_ACTION_TYPE;
