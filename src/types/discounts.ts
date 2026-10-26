export interface ManualDiscount { type: 'percentage' | 'fixed'; value: number }
export interface AppliedDiscount extends ManualDiscount { source: 'manual'; baseAmount: number; amount: number }
