import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export function Nav() {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-green-700 text-lg">
              PriceTracker
            </Link>
            <div className="hidden sm:flex items-center gap-4 text-sm">
              <Link href="/" className="text-gray-600 hover:text-gray-900 font-medium">
                Products
              </Link>
              <Link href="/receipts" className="text-gray-600 hover:text-gray-900 font-medium">
                Receipts
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/receipts/upload"
              className="px-3 py-1.5 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition-colors"
            >
              + Receipt
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>
    </nav>
  );
}
