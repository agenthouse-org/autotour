/**
 * Declarative login + profile journey for the ST-01 fixture contract.
 * Module and step IDs are fixed kebab-case identities derived from task meaning.
 */

export const DEFAULT_DISPLAY_NAME = "Ada Lovelace";

/**
 * @param {object} [options]
 * @param {string} [options.usernameEnv]
 * @param {string} [options.passwordEnv]
 * @param {string} [options.displayName]
 */
export function createProfileJourney({
  usernameEnv = "AUTOTOUR_USERNAME",
  passwordEnv = "AUTOTOUR_PASSWORD",
  displayName = DEFAULT_DISPLAY_NAME
} = {}) {
  return {
    id: "update-display-name",
    title: "Update display name",
    modules: [
      {
        id: "sign-in",
        title: "Sign in",
        route: "/login",
        dependencies: {
          views: ["LoginPage"]
        },
        steps: [
          {
            id: "open-login",
            action: "goto",
            description: "Open the sign-in page.",
            path: "/login",
            annotation: {
              callout: 1,
              caption: "Open the sign-in page."
            }
          },
          {
            id: "enter-email",
            action: "fill",
            description: "Enter the authorized account email.",
            target: { role: "textbox", name: "Email" },
            valueEnv: usernameEnv,
            annotation: {
              callout: 2,
              caption: "Enter the account email."
            }
          },
          {
            id: "enter-password",
            action: "fill",
            description: "Enter the authorized account password.",
            target: { role: "textbox", name: "Password" },
            valueEnv: passwordEnv,
            annotation: {
              callout: 3,
              caption: "Enter the account password."
            }
          },
          {
            id: "submit-login",
            action: "click",
            description: "Submit the sign-in form.",
            target: { role: "button", name: "Sign in" },
            expectRequests: ["POST /api/login"],
            annotation: {
              callout: 4,
              caption: "Sign in with the authorized account."
            }
          }
        ]
      },
      {
        id: "update-profile",
        title: "Update profile",
        route: "/settings/profile",
        dependencies: {
          views: ["ProfileSettings"]
        },
        steps: [
          {
            id: "open-profile",
            action: "goto",
            description: "Open profile settings.",
            path: "/settings/profile",
            expectRequests: ["GET /api/profile"],
            annotation: {
              callout: 1,
              caption: "Open profile settings."
            }
          },
          {
            id: "enter-display-name",
            action: "fill",
            description: "Enter an updated display name.",
            target: { role: "textbox", name: "Display name" },
            value: displayName,
            annotation: {
              callout: 2,
              caption: "Update the display name."
            }
          },
          {
            id: "save-profile",
            action: "click",
            description: "Save the updated display name.",
            target: { role: "button", name: "Save profile" },
            expectRequests: ["PUT /api/profile"],
            annotation: {
              callout: 3,
              caption: "Save the updated profile."
            }
          }
        ]
      }
    ]
  };
}

export const PROFILE_JOURNEY = createProfileJourney();
