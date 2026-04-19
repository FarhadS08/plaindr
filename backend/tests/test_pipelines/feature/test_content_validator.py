"""Tests for content quality validation — the gate between scraping and MongoDB.

These tests verify that garbage content (error pages, login forms, CAPTCHA,
marketing copy, navigation fragments) is rejected while real policy
documents pass through.
"""

from plaindr.pipelines.feature.content_validator import validate_content

# ── Real policy content (should PASS) ────────────────────


class TestValidPolicyContent:
    """Real policy content should always pass validation."""

    def test_standard_privacy_policy(self):
        content = (
            "# Privacy Policy\n\n"
            "## Introduction\n\n"
            "This privacy policy describes how we collect, use, and protect "
            "your personal data when you use our services. We are committed "
            "to protecting your privacy and handling your data in an open "
            "and transparent manner.\n\n"
            "## Data Collection\n\n"
            "We collect personal information such as your name, email address, "
            "and usage data to provide and improve our services.\n\n"
            "## Data Retention\n\n"
            "We retain your personal data for as long as necessary to fulfill "
            "the purposes outlined in this privacy policy.\n\n"
            "## Your Rights\n\n"
            "You have the right to access, correct, or delete your personal data. "
            "You may also opt out of certain data processing activities."
        )
        result = validate_content(content, "https://example.com/privacy")
        assert result.is_valid
        assert result.score >= 8

    def test_terms_of_service(self):
        content = (
            "# Terms of Service\n\n"
            "## Acceptance of Terms\n\n"
            "By accessing or using our platform, you agree to be bound by "
            "these terms of service and all applicable laws.\n\n"
            "## Permitted Use\n\n"
            "You may use our services for lawful purposes only. Unauthorized "
            "access or use of our platform is strictly prohibited.\n\n"
            "## Limitation of Liability\n\n"
            "In no event shall we be liable for any indirect, incidental, "
            "or consequential damages arising from your use of the services.\n\n"
            "## Governing Law\n\n"
            "These terms shall be governed by the laws of the applicable "
            "jurisdiction. Any disputes shall be resolved through arbitration."
        )
        result = validate_content(content, "https://example.com/terms")
        assert result.is_valid

    def test_data_processing_agreement(self):
        content = (
            "# Data Processing Agreement\n\n"
            "This data processing agreement governs the processing of personal "
            "data by the data processor on behalf of the data controller.\n\n"
            "## Definitions\n\n"
            "- Data Controller: The entity that determines the purposes and "
            "means of processing personal data.\n"
            "- Data Processor: The entity that processes personal data on "
            "behalf of the data controller.\n"
            "- Data Subject: The individual whose personal data is processed.\n\n"
            "## Scope and Purpose\n\n"
            "The data processor shall process personal data only on documented "
            "instructions from the data controller, including transfers of "
            "personal data to a third country.\n\n"
            "## Security Measures\n\n"
            "The data processor shall implement appropriate technical and "
            "organizational measures to ensure a level of security appropriate "
            "to the risk, including encryption of personal data."
        )
        result = validate_content(content, "https://example.com/dpa")
        assert result.is_valid
        assert result.score > 15  # Should score very high

    def test_minimal_but_valid_policy(self):
        """A modest but genuine policy should still pass."""
        content = (
            "# Cookie Policy\n\n"
            "We use cookies and similar tracking technologies to collect "
            "information about your browsing activity on our platform. "
            "By continuing to use our services, you consent to the use of "
            "cookies as described in this policy.\n\n"
            "## Types of Cookies\n\n"
            "We use essential cookies for platform functionality and "
            "analytics cookies to understand how visitors interact with "
            "our services. Third-party cookies may be set by our partners.\n\n"
            "## Opt-Out\n\n"
            "You may opt out of non-essential cookies at any time through "
            "your browser settings. Essential cookies are required for the "
            "platform to function and cannot be disabled.\n\n"
            "For more information about our data collection and retention "
            "practices, please refer to our privacy policy."
        )
        result = validate_content(content, "https://example.com/cookies")
        assert result.is_valid


# ── Error pages (should FAIL) ────────────────────────────


class TestErrorPageRejection:
    """Error pages must be caught and rejected."""

    def test_404_page(self):
        content = (
            "# 404 Not Found\n\n"
            "The page you requested was not found on our server. "
            "Please check the URL and try again. If you believe this "
            "is an error, please contact our support team for assistance. "
            "You can also return to our homepage to find what you're "
            "looking for. We apologize for any inconvenience this may cause.\n\n"
            "Here are some helpful links to get you back on track:\n"
            "- Homepage\n- Products\n- Contact Us\n- Help Center\n"
            "- Documentation\n- Blog\n- Status Page\n\n"
            "If the problem persists, please reach out to our technical "
            "support team with the URL you were trying to access."
        )
        result = validate_content(content, "https://example.com/missing")
        assert not result.is_valid
        assert "error page" in result.rejection_reason.lower()

    def test_403_forbidden(self):
        content = (
            "# 403 Forbidden\n\n"
            "You don't have permission to access this resource. "
            "If you believe this is a mistake, please contact the "
            "system administrator for further assistance with your "
            "request. Access to this page is restricted to authorized "
            "personnel only.\n\n"
            "Common reasons for this error include:\n"
            "- Your session may have expired\n"
            "- Your account may not have the required permissions\n"
            "- The resource may have been moved or restricted\n\n"
            "Please contact your administrator if you need access."
        )
        result = validate_content(content, "https://example.com/forbidden")
        assert not result.is_valid

    def test_access_denied_page(self):
        content = (
            "# Access Denied\n\n"
            "You are not authorized to view this page. Please sign in "
            "with appropriate credentials or contact your administrator "
            "to request access to this resource. This restriction is in "
            "place for security purposes to protect sensitive information.\n\n"
            "If you believe you should have access to this page, please "
            "submit a request through our internal ticketing system "
            "or contact the IT help desk during business hours.\n\n"
            "For urgent matters, please call our support line."
        )
        result = validate_content(content, "https://example.com/denied")
        assert not result.is_valid

    def test_page_not_found_variant(self):
        content = (
            "The page you were looking for could not be found. "
            "It may have been moved, deleted, or never existed. "
            "Please use the navigation menu to find what you need. "
            "You can also try searching our site for the content you "
            "were looking for or return to the homepage.\n\n"
            "We recently redesigned our website and some URLs may "
            "have changed. If you followed a link from another site, "
            "please let them know about this broken link. We apologize "
            "for the inconvenience and appreciate your patience."
        )
        result = validate_content(content, "https://example.com/gone")
        assert not result.is_valid


# ── Login forms (should FAIL when short) ─────────────────


class TestLoginFormRejection:
    """Short login form pages must be rejected."""

    def test_login_page(self):
        """Login forms are caught when content is short (<1500 chars)."""
        content = (
            "# Sign In\n\n"
            "Enter your email and password to access your account. "
            "If you forgot your password, click the link below to "
            "reset it. New users can create an account to get started "
            "with our platform and services.\n\n"
            "Don't have an account? Create one now to begin using "
            "our tools and services right away. Registration is free "
            "and takes less than a minute.\n\n"
            "## Trouble Signing In?\n\n"
            "If you're having trouble signing in, try resetting your "
            "password using the email address associated with your "
            "account. You can also contact our support team for help."
        )
        result = validate_content(content, "https://example.com/login")
        assert not result.is_valid
        assert "login" in result.rejection_reason.lower()

    def test_create_account_page(self):
        content = (
            "# Create an Account\n\n"
            "Enter your credentials to create a new account and get "
            "started with our platform. You will need to provide a "
            "valid email address and choose a secure password. "
            "By creating an account, you agree to our terms.\n\n"
            "Already have an account? Sign in here to access "
            "your existing dashboard and settings. We support "
            "single sign-on with Google, GitHub, and Microsoft.\n\n"
            "## Account Requirements\n\n"
            "Your password must be at least 8 characters long and "
            "include at least one number and one special character."
        )
        result = validate_content(content, "https://example.com/signup")
        assert not result.is_valid


# ── CAPTCHA / bot-check (should FAIL) ────────────────────


class TestCaptchaRejection:
    """CAPTCHA and bot-check pages must be rejected."""

    def test_cloudflare_challenge(self):
        content = (
            "Just a moment...\n\n"
            "Checking your browser before accessing the site. "
            "This process is automatic. Your browser will redirect "
            "to your requested content shortly. Please allow up to "
            "5 seconds for the verification to complete. This security "
            "check helps protect the site from automated access.\n\n"
            "If you continue to see this page, please ensure that "
            "JavaScript is enabled in your browser and that you are "
            "not using a VPN or proxy that might interfere with the "
            "verification process. You may also need to clear your "
            "browser cache and cookies before trying again."
        )
        result = validate_content(content, "https://example.com/cf")
        assert not result.is_valid
        assert "captcha" in result.rejection_reason.lower()

    def test_verify_human(self):
        content = (
            "# Security Check\n\n"
            "Please verify you are a human by completing the captcha "
            "below. This helps us prevent automated access to our "
            "site and protects our users from potential security "
            "threats. Complete the security check to proceed to "
            "the requested page content.\n\n"
            "If you are seeing this page frequently, it may be "
            "because your IP address has been flagged for unusual "
            "activity. This is usually temporary and should resolve "
            "within a few hours. Contact support if the issue persists."
        )
        result = validate_content(content, "https://example.com/check")
        assert not result.is_valid


# ── Marketing / non-policy content (should FAIL) ─────────


class TestNonPolicyRejection:
    """Marketing pages and other non-policy content should fail scoring."""

    def test_product_marketing_page(self):
        content = (
            "# The Best AI Tool for Your Business\n\n"
            "Transform your workflow with our cutting-edge AI solution. "
            "Our platform helps teams collaborate more effectively and "
            "deliver results faster than ever before. Join thousands "
            "of companies already using our technology.\n\n"
            "## Features\n\n"
            "- Real-time collaboration with team members across the globe\n"
            "- Advanced analytics dashboard with customizable reports\n"
            "- Seamless integration with popular tools and platforms\n"
            "- 24/7 customer support with dedicated account managers\n"
            "- Automated workflow builder for repetitive tasks\n\n"
            "## Pricing\n\n"
            "Start your free trial today! Plans start at just $9.99 per "
            "month. Enterprise plans available for larger teams with "
            "custom requirements and dedicated infrastructure."
        )
        result = validate_content(content, "https://example.com/product")
        assert not result.is_valid
        assert "quality score" in result.rejection_reason.lower()

    def test_blog_post(self):
        content = (
            "# How to Improve Your Productivity\n\n"
            "In today's fast-paced world, being productive is more "
            "important than ever. Here are our top tips for getting "
            "more done in less time and achieving your goals.\n\n"
            "## Tip 1: Set Clear Goals\n\n"
            "Start each day by setting clear, achievable goals. "
            "Write them down and prioritize them by importance.\n\n"
            "## Tip 2: Take Regular Breaks\n\n"
            "Studies show that taking short breaks can actually "
            "boost your overall productivity and focus throughout "
            "the day. Try the Pomodoro technique."
        )
        result = validate_content(content, "https://example.com/blog")
        assert not result.is_valid

    def test_navigation_fragment(self):
        content = (
            "Home About Products Contact Blog Careers Press Kit "
            "Investor Relations Newsroom Events Partners Developers "
            "Documentation API Reference Status Page Community Forum "
            "Support Center Help Desk FAQ Knowledge Base Tutorials "
            "Getting Started Quick Start Guide Developer Portal "
            "Changelog Release Notes Roadmap Feature Requests "
            "Bug Reports Issue Tracker Code Repository "
            "Open Source Contributions License Terms"
        )
        result = validate_content(content, "https://example.com/nav")
        assert not result.is_valid


# ── Hard gate: minimum length ────────────────────────────


class TestMinimumLength:
    def test_too_short_content(self):
        content = "This is a short privacy policy about data collection."
        result = validate_content(content, "https://example.com/p")
        assert not result.is_valid
        assert "too short" in result.rejection_reason.lower()

    def test_empty_content(self):
        result = validate_content("", "https://example.com/p")
        assert not result.is_valid

    def test_whitespace_only(self):
        result = validate_content("   \n\n  ", "https://example.com/p")
        assert not result.is_valid


# ── Validation result metadata ───────────────────────────


class TestValidationMetadata:
    def test_valid_result_has_score(self):
        content = (
            "# Privacy Policy\n\n"
            "## Data Collection\n\n"
            "We collect personal data including name, email, and usage "
            "information. Your personal information is processed in "
            "accordance with applicable data protection laws including "
            "GDPR and CCPA.\n\n"
            "## Data Retention\n\n"
            "We retain your data for as long as necessary to provide "
            "our services and comply with legal obligations. When your "
            "data is no longer needed, we securely delete it.\n\n"
            "## Your Rights\n\n"
            "You have the right to access, correct, or delete your "
            "personal data. You may also opt out of certain processing "
            "activities. Contact us to exercise these rights."
        )
        result = validate_content(content, "https://example.com/privacy")
        assert result.is_valid
        assert result.score > 0
        assert result.rejection_reason is None

    def test_rejected_result_has_reason(self):
        content = "Short."
        result = validate_content(content, "https://example.com/p")
        assert not result.is_valid
        assert result.rejection_reason is not None

    def test_warnings_for_missing_headings(self):
        content = (
            "This privacy policy describes how we collect, use, and protect "
            "your personal data when you use our services and platform. "
            "We collect personal information including your name, email, "
            "and usage data. You have the right to access and delete your "
            "personal data at any time by contacting our data protection "
            "officer. We comply with applicable data protection laws "
            "including GDPR and CCPA. Third parties may process your "
            "data on our behalf as described in this privacy policy. "
            "We retain personal data only as long as necessary for the "
            "purposes outlined herein and in accordance with our data "
            "retention schedule. Users may opt out of data collection."
        )
        result = validate_content(content, "https://example.com/p")
        assert result.is_valid  # Should still pass on terminology
        assert any("heading" in w.lower() for w in result.warnings)
