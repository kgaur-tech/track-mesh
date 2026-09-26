import type { NextAuthConfig } from "next-auth";
import type { OAuthConfig } from "@auth/core/providers/oauth";

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

type GoogleProfile = {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
};

const googleProvider: OAuthConfig<GoogleProfile> | undefined = googleClientId && googleClientSecret
  ? {
      id: "google",
      name: "Google",
      type: "oauth",
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: { scope: "openid email profile", response_type: "code" },
      },
      token: "https://oauth2.googleapis.com/token",
      userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? null,
          email: profile.email ?? null,
          image: profile.picture ?? null,
        };
      },
    }
  : undefined;

const authConfig = {
  secret: process.env.AUTH_SECRET,
  providers: googleProvider ? [googleProvider] : [],
  pages: {
    signIn: "/sign-in",
  },
  trustHost: true,
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const isProtectedPage = pathname.startsWith("/app") || pathname.startsWith("/leader");

      if (process.env.NODE_ENV === "development") return true;
      if (!isProtectedPage) return true;
      if (auth?.user) return true;

      const signInUrl = new URL("/sign-in", request.nextUrl.origin);
      signInUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
      return Response.redirect(signInUrl);
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
