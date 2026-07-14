import {
  Skeleton as HeroSkeleton,
  type SkeletonProps,
} from "heroui-native/skeleton"
import { cn } from "heroui-native/utils"

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <HeroSkeleton className={cn("rounded-lor-sm", className)} {...props} />
}
