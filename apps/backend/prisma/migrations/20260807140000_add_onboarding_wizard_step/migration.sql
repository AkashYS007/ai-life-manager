-- CreateEnum
CREATE TYPE "OnboardingWizardStep" AS ENUM ('CALENDAR', 'PLAN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarding_wizard_step" "OnboardingWizardStep";
