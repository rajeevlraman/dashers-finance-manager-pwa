// investmentCalculations.js
//
// Pure property-investment math used by the Tax page's Rental Yield and
// Property Cash Flow calculators (js/tax_compliance.js). Split out here,
// same as loanCalculations.js/taxCalculations.js, so the actual numbers
// can be unit tested without touching the DOM or IndexedDB — the UI
// module pulls real property/loan/transaction data and passes plain
// numbers in.

// ============================================================================
// 📐 Rental Yield
// ============================================================================
export function calculateRentalYield({ purchasePrice, monthlyRent, annualCosts = 0 }) {
  const safePurchasePrice = Math.max(parseFloat(purchasePrice) || 0, 0);
  const safeMonthlyRent = Math.max(parseFloat(monthlyRent) || 0, 0);
  const safeAnnualCosts = Math.max(parseFloat(annualCosts) || 0, 0);

  const annualRent = safeMonthlyRent * 12;
  const grossYield = safePurchasePrice > 0 ? (annualRent / safePurchasePrice) * 100 : 0;
  const netYield = safePurchasePrice > 0 ? ((annualRent - safeAnnualCosts) / safePurchasePrice) * 100 : 0;

  return { annualRent, grossYield, netYield };
}

// ============================================================================
// 💵 Property Cash Flow
// ============================================================================
export function calculatePropertyCashFlow({ monthlyRent, mortgageRepayment = 0, otherCosts = 0 }) {
  const safeMonthlyRent = Math.max(parseFloat(monthlyRent) || 0, 0);
  const safeMortgage = Math.max(parseFloat(mortgageRepayment) || 0, 0);
  const safeOtherCosts = Math.max(parseFloat(otherCosts) || 0, 0);

  const monthlyCashFlow = safeMonthlyRent - safeMortgage - safeOtherCosts;

  return {
    monthlyCashFlow,
    annualCashFlow: monthlyCashFlow * 12,
    isPositive: monthlyCashFlow >= 0
  };
}
