from google_auth_oauthlib.flow import InstalledAppFlow

# This scope allows reading/writing tasks
SCOPES = ['https://www.googleapis.com/auth/tasks']

def main():
    flow = InstalledAppFlow.from_client_secrets_file(
        'client_secret.json', SCOPES)

    # This will print a URL. You open it, approve, and paste the code back here.
    creds = flow.run_console()

    print("\n--- SUCCESS! SAVE THIS INFO ---")
    print(f"REFRESH_TOKEN = '{creds.refresh_token}'")
    print(f"CLIENT_ID = '{creds.client_id}'")
    print(f"CLIENT_SECRET = '{creds.client_secret}'")

if __name__ == '__main__':
    main()
