import os
from dotenv import load_dotenv

def initialize_app_config():
    """
    Loads environment variables from .env and sets them into the
    global configuration object/environment namespace.
    This MUST run first at application startup.
    """
    print("--- Initializing Application Configuration ---")
    # Load variables from a local .env file if it exists
    dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(dotenv_path):
        load_dotenv(dotenv_path=dotenv_path)

    # Expose required credentials through the process environment variables
    # This makes them available universally to modules like igdb_service.py
    required_vars = ["IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET"]
    for var in required_vars:
        if os.environ.get(var):
            print(f"✅ Loaded {var} from environment.")

# Global configuration loading call (Run this BEFORE app initialization)
initialize_app_config() 