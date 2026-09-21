import type { Metadata } from "next";
import { ReviewView } from "./review-view";

export const metadata: Metadata = {
  title: "Review",
};

export default function ReviewPage() {
  return <ReviewView />;
}
