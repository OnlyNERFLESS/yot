# Copy to env.sh and adjust for your machine, then `. ./env.sh` before building.
export PATH="$HOME/.cargo/bin:$PATH"
export JAVA_HOME="/path/to/jdk-17"
export ANDROID_HOME="/path/to/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
# Optional: share one target dir between the workspace crates and the app.
# export CARGO_TARGET_DIR="$PWD/target"
