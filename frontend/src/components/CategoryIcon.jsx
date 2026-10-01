import { Sparkles, ChefHat, HeartPulse, Gamepad2, PawPrint, Dumbbell, Briefcase, Baby, Wrench, Cpu, Package } from 'lucide-react'

const ICONS = {
  beauty: Sparkles,
  kitchen: ChefHat,
  health: HeartPulse,
  toys: Gamepad2,
  pets: PawPrint,
  sports: Dumbbell,
  office: Briefcase,
  baby: Baby,
  tools: Wrench,
  electronics: Cpu,
}

export default function CategoryIcon({ category, size = 14, ...props }) {
  const Icon = ICONS[category] || Package
  return <Icon size={size} {...props} />
}
