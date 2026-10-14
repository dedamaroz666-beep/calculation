import os
import sys

# Ensure Analysis directory is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
analysis_dir = os.path.join(current_dir, "Analysis")
if analysis_dir not in sys.path:
    sys.path.insert(0, analysis_dir)

# Change working directory so Flask templates and static folders resolve correctly
os.chdir(analysis_dir)

from app import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
