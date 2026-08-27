import { Desktop } from "@/components/desktop/Desktop";
import { LoginGate } from "@/components/login/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <Desktop />
    </LoginGate>
  );
}
