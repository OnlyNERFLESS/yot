buildscript {
    repositories {
        maven("https://redirector.gvt1.com/edgedl/android/maven2/") // google(): dl.google.com 404s on this network
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        maven("https://redirector.gvt1.com/edgedl/android/maven2/") // google(): dl.google.com 404s on this network
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

