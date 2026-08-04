export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateContractPlan(input: {
  monthlyInstallments: number;
  monthlyAmount: number;
  depositAmount: number;
  paidInstallmentsAmount?: number;
}) {
  const monthlyTotal = roundMoney(input.monthlyInstallments * input.monthlyAmount);
  const amountReceived = roundMoney(input.depositAmount + (input.paidInstallmentsAmount ?? 0));
  const totalContract = roundMoney(input.depositAmount + monthlyTotal);

  return {
    monthlyInstallments: input.monthlyInstallments,
    monthlyTotal,
    depositAmount: roundMoney(input.depositAmount),
    totalContract,
    amountReceived,
    remainingBalance: roundMoney(Math.max(0, totalContract - amountReceived)),
  };
}
